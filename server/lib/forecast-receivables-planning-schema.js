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
const {
  BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE,
  BILLING_SOURCE_AUTHORITY_MIGRATION_ID,
  BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
  BILLING_SOURCE_EFFECTIVE_TERMS_TABLE,
  BILLING_SOURCE_RENTAL_LINES_TABLE,
  assertBillingSourceAuthorityStructure,
} = require('./billing-source-authority-schema');

const FORECAST_RECEIVABLES_PLANNING_SCHEMA_VERSION = 1;
const FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID = 'forecast_receivables_planning_pr7';

const FORECAST_RECEIVABLE_RUNS_TABLE = 'forecast_receivable_runs';
const FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE = 'forecast_receivable_run_supersessions';
const FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE = 'forecast_receivable_input_snapshots';
const FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE = 'forecast_receivable_input_events';
const FORECAST_RECEIVABLE_ITEMS_TABLE = 'forecast_receivable_items';
const FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE = 'forecast_receivable_diagnostics';
const FORECAST_RECEIVABLE_OPERATIONS_TABLE = 'forecast_receivable_operations';
const FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE = 'forecast_receivable_audit_events';

const FORECAST_RECEIVABLES_PLANNING_TABLES = Object.freeze([
  FORECAST_RECEIVABLE_RUNS_TABLE,
  FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE,
  FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE,
  FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE,
  FORECAST_RECEIVABLE_ITEMS_TABLE,
  FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE,
  FORECAST_RECEIVABLE_OPERATIONS_TABLE,
  FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE,
]);

const REQUIRED_COLUMNS = Object.freeze({
  [FORECAST_RECEIVABLE_RUNS_TABLE]: [
    'id', 'companyId', 'branchId', 'companyTimezone', 'planningSeriesKey', 'asOfDate',
    'horizonStartDate', 'horizonEndDateExclusive', 'horizonDays', 'currency',
    'calculationVersion', 'inputContractVersion', 'confidencePolicyVersion',
    'coveragePolicyVersion', 'inputSetManifestPresent', 'inputSetManifestSourceSystem',
    'inputSetManifestSourceSnapshotVersion', 'inputSetManifestCoveredBranchId',
    'inputSetManifestCoveredStartDate', 'inputSetManifestCoveredEndDateExclusive',
    'inputSetManifestRentalStatusesJson', 'inputSetManifestAuthorityStatus',
    'inputSetManifestPolicyRef', 'inputSetManifestSourceHash', 'inputSetManifestHash',
    'inputSetManifestSchemaVersion', 'inputSetHash', 'resultHash', 'status', 'completenessState',
    'openPeriodForecastNetMinor', 'openPeriodForecastVatMinor',
    'openPeriodForecastGrossMinor', 'plannedFutureNetMinor', 'plannedFutureVatMinor',
    'plannedFutureGrossMinor', 'primaryForecastMinor', 'inputSnapshotCount',
    'inputEventCount', 'inputCompletenessManifestCount', 'itemCount', 'diagnosticCount',
    'blockingDiagnosticCount', 'predecessorCount', 'operationId', 'calculatedAt',
    'correlationId', 'schemaVersion',
  ],
  [FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE]: [
    'id', 'companyId', 'branchId', 'planningSeriesKey', 'predecessorRunId',
    'successorRunId', 'operationId', 'reasonCode', 'reasonText', 'schemaVersion', 'createdAt',
  ],
  [FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE]: [
    'id', 'forecastRunId', 'companyId', 'branchId', 'rentalLineId',
    'activationBoundaryId', 'activationBoundarySourceHash', 'effectiveTermsVersionId',
    'effectiveTermsSourceVersion', 'effectiveTermsSourceHash', 'clientId', 'contractId', 'rentalId',
    'equipmentId', 'rentalStatus', 'componentKind', 'serviceStartDate',
    'serviceEndDateExclusive', 'candidateStartDate', 'candidateEndDateExclusive',
    'sourceSystem', 'sourceIdentity', 'sourceEventId', 'sourceEventVersion', 'sourceHash',
    'completenessManifestPresent', 'manifestSourceSystem', 'manifestSourceSnapshotVersion',
    'manifestSourceEventWatermarkVersion', 'manifestEventKindsCoveredJson',
    'manifestCoveredStartDate', 'manifestCoveredEndDateExclusive', 'manifestSourceHash',
    'manifestAuthorityStatus', 'manifestPolicyRef', 'eventManifestHash',
    'policyBundleRefsJson', 'inputSourceHash', 'authorityStatus',
    'completenessStatus', 'schemaVersion', 'createdAt',
  ],
  [FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE]: [
    'id', 'forecastRunId', 'inputSnapshotId', 'companyId', 'branchId', 'rentalLineId',
    'eventKind', 'sourceSystem', 'sourceId', 'sourceVersion', 'sourceEventId',
    'sourceEventVersion', 'effectiveStartDate', 'effectiveEndDateExclusive',
    'authorityStatus', 'authorityPolicyRef', 'evidenceHash', 'schemaVersion', 'createdAt',
  ],
  [FORECAST_RECEIVABLE_ITEMS_TABLE]: [
    'id', 'forecastRunId', 'inputSnapshotId', 'forecastCoverageKey', 'companyId',
    'branchId', 'componentKind', 'clientId', 'contractId', 'rentalId', 'rentalLineId',
    'effectiveTermsVersionId', 'coverageStartDate', 'coverageEndDateExclusive', 'currency',
    'netAmountMinor', 'vatAmountMinor', 'grossAmountMinor', 'calculationVersion',
    'calculationPolicyRef', 'vatPolicyRef', 'roundingPolicyRef', 'policyDecisionRef',
    'confidence', 'confidenceReasonCodesJson', 'normalizedCalculationEvidenceJson',
    'itemSourceHash', 'itemResultHash', 'schemaVersion', 'createdAt',
  ],
  [FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE]: [
    'id', 'forecastRunId', 'inputSnapshotId', 'companyId', 'branchId', 'rentalLineId',
    'componentKind', 'affectedStartDate', 'affectedEndDateExclusive', 'severity',
    'confidence', 'reasonCode', 'sourceIdentity', 'sourceHash', 'policyRef',
    'correlationId', 'schemaVersion', 'createdAt',
  ],
  [FORECAST_RECEIVABLE_OPERATIONS_TABLE]: [
    'id', 'companyId', 'branchId', 'operationType', 'idempotencyKey',
    'commandFingerprint', 'inputSetHash', 'planningSeriesKey', 'actorPrincipalId',
    'actorMembershipId', 'actorMembershipVersion', 'roleTemplateKey',
    'roleTemplateVersion', 'capabilityCatalogVersion', 'capabilityKey', 'resultRunId',
    'resultHash', 'auditEventId', 'correlationId', 'schemaVersion', 'createdAt',
  ],
  [FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE]: [
    'id', 'companyId', 'branchId', 'aggregateType', 'aggregateId', 'aggregateVersion',
    'eventType', 'actorType', 'actorPrincipalId', 'actorMembershipId',
    'actorMembershipVersion', 'roleTemplateKey', 'roleTemplateVersion',
    'capabilityCatalogVersion', 'capabilityKey', 'correlationId', 'reasonCode',
    'reasonText', 'beforeFingerprint', 'afterFingerprint', 'inputSetHash', 'resultHash',
    'operationId', 'schemaVersion', 'createdAt',
  ],
});

const REQUIRED_INDEXES = Object.freeze([
  'uq_forecast_run_operation',
  'uq_forecast_run_supersession_predecessor',
  'uq_forecast_input_per_run_line_component_interval',
  'uq_forecast_event_source_identity',
  'uq_forecast_item_coverage',
  'uq_forecast_operation_identity',
  'uq_forecast_operation_result',
  'idx_forecast_current_runs',
  'idx_forecast_runs_scope',
  'idx_forecast_items_scope',
  'idx_forecast_diagnostics_scope',
  'idx_forecast_supersession_successor',
  'idx_forecast_inputs_scope',
]);

const REQUIRED_TRIGGERS = Object.freeze([
  ...FORECAST_RECEIVABLES_PLANNING_TABLES.flatMap(table => [
    `trg_${table}_no_update`,
    `trg_${table}_no_delete`,
  ]),
  'trg_forecast_receivable_operations_no_replace',
  'trg_forecast_receivable_audit_events_no_replace',
  'trg_forecast_run_supersession_validate',
  'trg_forecast_input_snapshot_validate',
  'trg_forecast_input_event_validate',
  'trg_forecast_item_validate',
  'trg_forecast_item_no_overlap',
  'trg_forecast_diagnostic_validate',
  'trg_forecast_operation_finalize_run',
]);

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
    throw new Error(`FORECAST_PR7_PREREQUISITE_REQUIRED:${name}:v${version}`);
  }
}

function assertForeignKeysEnabled(db) {
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('FORECAST_PR7_FOREIGN_KEYS_REQUIRED');
  }
}

function assertForeignKeyCheckClean(db) {
  const failures = db.pragma('foreign_key_check');
  if (failures.length > 0) {
    throw new Error(`FORECAST_PR7_FOREIGN_KEY_CHECK_FAILED:${JSON.stringify(failures)}`);
  }
}

function assertNoCanonicalFinancialRows(db) {
  for (const table of FINANCIAL_TABLES) {
    const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    if (count !== 0) throw new Error(`FORECAST_PR7_CANONICAL_ROWS_PRESENT:${table}:${count}`);
  }
}

function assertCapabilityCatalogExact(db) {
  const versions = db.prepare(`
    SELECT version, status FROM capability_catalog_versions ORDER BY version
  `).all();
  if (versions.length !== 1 || Number(versions[0].version) !== 1 || versions[0].status !== 'active') {
    throw new Error('FORECAST_PR7_CAPABILITY_CATALOG_MISMATCH');
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
    throw new Error('FORECAST_PR7_CAPABILITY_CATALOG_MISMATCH');
  }
}

function hasUnexpectedPartialState(db) {
  if (FORECAST_RECEIVABLES_PLANNING_TABLES.some(table => tableExists(db, table))) return true;
  return db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE name LIKE 'uq_forecast_%'
       OR name LIKE 'idx_forecast_%'
       OR name LIKE 'trg_forecast_%'
    LIMIT 1
  `).get() != null;
}

function assertForecastReceivablesPlanningStructure(db, { requireMigration = true } = {}) {
  assertForeignKeysEnabled(db);
  assertPlatformIdentityStructure(db);
  assertBillingSourceAuthorityStructure(db);
  assertCapabilityCatalogExact(db);
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!tableExists(db, table)) throw new Error(`FORECAST_PR7_SCHEMA_INCOMPLETE:${table}`);
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    for (const column of columns) {
      if (!actual.has(column)) throw new Error(`FORECAST_PR7_SCHEMA_INCOMPLETE:${table}.${column}`);
    }
  }
  for (const index of REQUIRED_INDEXES) {
    if (!objectExists(db, 'index', index)) throw new Error(`FORECAST_PR7_SCHEMA_INCOMPLETE:${index}`);
  }
  for (const trigger of REQUIRED_TRIGGERS) {
    if (!objectExists(db, 'trigger', trigger)) throw new Error(`FORECAST_PR7_SCHEMA_INCOMPLETE:${trigger}`);
  }
  if (requireMigration) {
    const row = migrationRow(db, FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID);
    if (Number(row?.version) !== FORECAST_RECEIVABLES_PLANNING_SCHEMA_VERSION) {
      throw new Error('FORECAST_PR7_MIGRATION_REGISTRY_MISMATCH');
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

function ensureForecastReceivablesPlanningSchema(db) {
  db.pragma('foreign_keys = ON');
  assertForeignKeysEnabled(db);
  assertMigration(db, CANONICAL_RECEIVABLES_MIGRATION_ID, CANONICAL_RECEIVABLES_SCHEMA_VERSION);
  assertMigration(
    db,
    CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID,
    CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION,
  );
  assertMigration(db, PLATFORM_IDENTITY_MIGRATION_ID, PLATFORM_IDENTITY_SCHEMA_VERSION);
  assertMigration(db, BILLING_SOURCE_AUTHORITY_MIGRATION_ID, BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION);
  assertPlatformIdentityStructure(db);
  assertBillingSourceAuthorityStructure(db);
  assertCapabilityCatalogExact(db);
  assertForeignKeyCheckClean(db);

  const applied = migrationRow(db, FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID);
  if (applied) {
    if (Number(applied.version) !== FORECAST_RECEIVABLES_PLANNING_SCHEMA_VERSION) {
      throw new Error(`FORECAST_PR7_MIGRATION_VERSION_MISMATCH:${applied.version}`);
    }
    assertForecastReceivablesPlanningStructure(db);
    return false;
  }
  if (hasUnexpectedPartialState(db)) throw new Error('FORECAST_PR7_UNEXPECTED_PARTIAL_STATE');
  assertNoCanonicalFinancialRows(db);

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE ${FORECAST_RECEIVABLE_RUNS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        companyTimezone TEXT NOT NULL,
        planningSeriesKey TEXT NOT NULL,
        asOfDate TEXT NOT NULL,
        horizonStartDate TEXT NOT NULL,
        horizonEndDateExclusive TEXT NOT NULL,
        horizonDays INTEGER NOT NULL,
        currency TEXT NOT NULL,
        calculationVersion TEXT NOT NULL,
        inputContractVersion TEXT NOT NULL,
        confidencePolicyVersion TEXT NOT NULL,
        coveragePolicyVersion TEXT NOT NULL,
        inputSetManifestPresent INTEGER NOT NULL,
        inputSetManifestSourceSystem TEXT,
        inputSetManifestSourceSnapshotVersion INTEGER,
        inputSetManifestCoveredBranchId TEXT,
        inputSetManifestCoveredStartDate TEXT,
        inputSetManifestCoveredEndDateExclusive TEXT,
        inputSetManifestRentalStatusesJson TEXT,
        inputSetManifestAuthorityStatus TEXT,
        inputSetManifestPolicyRef TEXT,
        inputSetManifestSourceHash TEXT,
        inputSetManifestHash TEXT,
        inputSetManifestSchemaVersion INTEGER,
        inputSetHash TEXT NOT NULL,
        resultHash TEXT NOT NULL,
        status TEXT NOT NULL,
        completenessState TEXT NOT NULL,
        openPeriodForecastNetMinor INTEGER NOT NULL,
        openPeriodForecastVatMinor INTEGER NOT NULL,
        openPeriodForecastGrossMinor INTEGER NOT NULL,
        plannedFutureNetMinor INTEGER NOT NULL,
        plannedFutureVatMinor INTEGER NOT NULL,
        plannedFutureGrossMinor INTEGER NOT NULL,
        primaryForecastMinor INTEGER NOT NULL,
        inputSnapshotCount INTEGER NOT NULL,
        inputEventCount INTEGER NOT NULL,
        inputCompletenessManifestCount INTEGER NOT NULL,
        itemCount INTEGER NOT NULL,
        diagnosticCount INTEGER NOT NULL,
        blockingDiagnosticCount INTEGER NOT NULL,
        predecessorCount INTEGER NOT NULL,
        operationId TEXT NOT NULL,
        calculatedAt TEXT NOT NULL,
        correlationId TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        UNIQUE (id, companyId, branchId),
        UNIQUE (operationId, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (operationId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        CHECK (lower(branchId) NOT IN ('*', 'all', 'global', 'company-wide', 'company_wide', 'any', 'null')),
        CHECK (date(asOfDate) = asOfDate AND date(horizonStartDate) = horizonStartDate AND date(horizonEndDateExclusive) = horizonEndDateExclusive),
        CHECK (horizonStartDate = asOfDate AND horizonStartDate < horizonEndDateExclusive),
        CHECK (horizonDays = 30),
        CHECK (currency = 'RUB'),
        CHECK (length(planningSeriesKey) = 64 AND length(inputSetHash) = 64 AND length(resultHash) = 64),
        CHECK (inputSetManifestPresent IN (0, 1)),
        CHECK ((inputSetManifestPresent = 0
          AND inputSetManifestSourceSystem IS NULL
          AND inputSetManifestSourceSnapshotVersion IS NULL
          AND inputSetManifestCoveredBranchId IS NULL
          AND inputSetManifestCoveredStartDate IS NULL
          AND inputSetManifestCoveredEndDateExclusive IS NULL
          AND inputSetManifestRentalStatusesJson IS NULL
          AND inputSetManifestAuthorityStatus IS NULL
          AND inputSetManifestPolicyRef IS NULL
          AND inputSetManifestSourceHash IS NULL
          AND inputSetManifestHash IS NULL
          AND inputSetManifestSchemaVersion IS NULL)
          OR (inputSetManifestPresent = 1
          AND inputSetManifestSourceSystem IS NOT NULL
          AND inputSetManifestSourceSnapshotVersion IS NOT NULL
          AND inputSetManifestCoveredBranchId IS NOT NULL
          AND inputSetManifestCoveredStartDate IS NOT NULL
          AND inputSetManifestCoveredEndDateExclusive IS NOT NULL
          AND inputSetManifestRentalStatusesJson IS NOT NULL
          AND inputSetManifestAuthorityStatus IS NOT NULL
          AND inputSetManifestSourceHash IS NOT NULL
          AND inputSetManifestHash IS NOT NULL
          AND inputSetManifestSchemaVersion IS NOT NULL
          AND length(trim(inputSetManifestSourceSystem)) BETWEEN 1 AND 160
          AND typeof(inputSetManifestSourceSnapshotVersion) = 'integer' AND inputSetManifestSourceSnapshotVersion >= 1
          AND inputSetManifestCoveredBranchId = branchId
          AND length(inputSetManifestCoveredBranchId) <= 160
          AND date(inputSetManifestCoveredStartDate) = inputSetManifestCoveredStartDate
          AND date(inputSetManifestCoveredEndDateExclusive) = inputSetManifestCoveredEndDateExclusive
          AND inputSetManifestCoveredStartDate < inputSetManifestCoveredEndDateExclusive
          AND json_valid(inputSetManifestRentalStatusesJson)
          AND json_type(inputSetManifestRentalStatusesJson) = 'array'
          AND length(inputSetManifestRentalStatusesJson) <= 4096
          AND inputSetManifestAuthorityStatus IN ('approved_by_reference', 'unresolved', 'rejected')
          AND (inputSetManifestPolicyRef IS NULL OR length(trim(inputSetManifestPolicyRef)) BETWEEN 1 AND 160)
          AND length(inputSetManifestSourceHash) = 64
          AND length(inputSetManifestHash) = 64
          AND inputSetManifestSchemaVersion = 1)),
        CHECK (status IN ('calculated', 'calculated_with_gaps', 'insufficient')),
        CHECK (completenessState IN ('complete', 'gaps', 'insufficient')),
        CHECK ((status = 'calculated' AND completenessState = 'complete' AND blockingDiagnosticCount = 0)
          OR (status = 'calculated_with_gaps' AND completenessState = 'gaps' AND itemCount > 0 AND blockingDiagnosticCount > 0)
          OR (status = 'insufficient' AND completenessState = 'insufficient' AND itemCount = 0 AND blockingDiagnosticCount > 0)),
        CHECK (typeof(openPeriodForecastNetMinor) = 'integer' AND openPeriodForecastNetMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(openPeriodForecastVatMinor) = 'integer' AND openPeriodForecastVatMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(openPeriodForecastGrossMinor) = 'integer' AND openPeriodForecastGrossMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(plannedFutureNetMinor) = 'integer' AND plannedFutureNetMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(plannedFutureVatMinor) = 'integer' AND plannedFutureVatMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(plannedFutureGrossMinor) = 'integer' AND plannedFutureGrossMinor BETWEEN 0 AND 9007199254740991),
        CHECK (openPeriodForecastNetMinor + openPeriodForecastVatMinor = openPeriodForecastGrossMinor),
        CHECK (plannedFutureNetMinor + plannedFutureVatMinor = plannedFutureGrossMinor),
        CHECK (primaryForecastMinor = openPeriodForecastGrossMinor),
        CHECK (typeof(inputSnapshotCount) = 'integer' AND inputSnapshotCount >= 0),
        CHECK (typeof(inputEventCount) = 'integer' AND inputEventCount >= 0),
        CHECK (typeof(inputCompletenessManifestCount) = 'integer'
          AND inputCompletenessManifestCount >= 0
          AND inputCompletenessManifestCount <= inputSnapshotCount),
        CHECK (typeof(itemCount) = 'integer' AND itemCount >= 0),
        CHECK (typeof(diagnosticCount) = 'integer' AND diagnosticCount >= 0),
        CHECK (typeof(blockingDiagnosticCount) = 'integer' AND blockingDiagnosticCount >= 0 AND blockingDiagnosticCount <= diagnosticCount),
        CHECK (typeof(predecessorCount) = 'integer' AND predecessorCount >= 0),
        CHECK (calculatedAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (typeof(schemaVersion) = 'integer' AND schemaVersion = 1)
      );

      CREATE TABLE ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        planningSeriesKey TEXT NOT NULL,
        predecessorRunId TEXT NOT NULL,
        successorRunId TEXT NOT NULL,
        operationId TEXT NOT NULL,
        reasonCode TEXT NOT NULL,
        reasonText TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (predecessorRunId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (successorRunId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (operationId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        CHECK (predecessorRunId != successorRunId),
        CHECK (length(planningSeriesKey) = 64),
        CHECK (length(trim(reasonCode)) > 0 AND length(trim(reasonText)) > 0),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE} (
        id TEXT PRIMARY KEY,
        forecastRunId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        rentalLineId TEXT NOT NULL,
        activationBoundaryId TEXT NOT NULL,
        activationBoundarySourceHash TEXT NOT NULL,
        effectiveTermsVersionId TEXT NOT NULL,
        effectiveTermsSourceVersion INTEGER NOT NULL,
        effectiveTermsSourceHash TEXT NOT NULL,
        clientId TEXT NOT NULL,
        contractId TEXT,
        rentalId TEXT NOT NULL,
        equipmentId TEXT,
        rentalStatus TEXT NOT NULL,
        componentKind TEXT NOT NULL,
        serviceStartDate TEXT NOT NULL,
        serviceEndDateExclusive TEXT NOT NULL,
        candidateStartDate TEXT NOT NULL,
        candidateEndDateExclusive TEXT NOT NULL,
        sourceSystem TEXT NOT NULL,
        sourceIdentity TEXT NOT NULL,
        sourceEventId TEXT NOT NULL,
        sourceEventVersion INTEGER NOT NULL,
        sourceHash TEXT NOT NULL,
        completenessManifestPresent INTEGER NOT NULL,
        manifestSourceSystem TEXT,
        manifestSourceSnapshotVersion INTEGER,
        manifestSourceEventWatermarkVersion INTEGER,
        manifestEventKindsCoveredJson TEXT,
        manifestCoveredStartDate TEXT,
        manifestCoveredEndDateExclusive TEXT,
        manifestSourceHash TEXT,
        manifestAuthorityStatus TEXT,
        manifestPolicyRef TEXT,
        eventManifestHash TEXT,
        policyBundleRefsJson TEXT NOT NULL,
        inputSourceHash TEXT NOT NULL,
        authorityStatus TEXT NOT NULL,
        completenessStatus TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (forecastRunId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (rentalLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_RENTAL_LINES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (activationBoundaryId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (effectiveTermsVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_EFFECTIVE_TERMS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (componentKind IN ('open_period_forecast', 'planned_future')),
        CHECK (date(serviceStartDate) = serviceStartDate AND date(serviceEndDateExclusive) = serviceEndDateExclusive AND serviceStartDate < serviceEndDateExclusive),
        CHECK (date(candidateStartDate) = candidateStartDate AND date(candidateEndDateExclusive) = candidateEndDateExclusive AND candidateStartDate < candidateEndDateExclusive),
        CHECK (serviceStartDate <= candidateStartDate AND candidateEndDateExclusive <= serviceEndDateExclusive),
        CHECK (length(activationBoundarySourceHash) = 64),
        CHECK (typeof(effectiveTermsSourceVersion) = 'integer' AND effectiveTermsSourceVersion >= 1),
        CHECK (length(effectiveTermsSourceHash) = 64),
        CHECK (typeof(sourceEventVersion) = 'integer' AND sourceEventVersion >= 1),
        CHECK (length(sourceHash) = 64 AND (eventManifestHash IS NULL OR length(eventManifestHash) = 64) AND length(inputSourceHash) = 64),
        CHECK (completenessManifestPresent IN (0, 1)),
        CHECK ((completenessManifestPresent = 0
          AND manifestSourceSystem IS NULL
          AND manifestSourceSnapshotVersion IS NULL
          AND manifestSourceEventWatermarkVersion IS NULL
          AND manifestEventKindsCoveredJson IS NULL
          AND manifestCoveredStartDate IS NULL
          AND manifestCoveredEndDateExclusive IS NULL
          AND manifestSourceHash IS NULL
          AND manifestAuthorityStatus IS NULL
          AND manifestPolicyRef IS NULL
          AND eventManifestHash IS NULL)
          OR (completenessManifestPresent = 1
          AND manifestSourceSystem IS NOT NULL
          AND manifestSourceSnapshotVersion IS NOT NULL
          AND manifestSourceEventWatermarkVersion IS NOT NULL
          AND manifestEventKindsCoveredJson IS NOT NULL
          AND manifestCoveredStartDate IS NOT NULL
          AND manifestCoveredEndDateExclusive IS NOT NULL
          AND manifestSourceHash IS NOT NULL
          AND manifestAuthorityStatus IS NOT NULL
          AND eventManifestHash IS NOT NULL
          AND length(trim(manifestSourceSystem)) BETWEEN 1 AND 160
          AND typeof(manifestSourceSnapshotVersion) = 'integer' AND manifestSourceSnapshotVersion >= 1
          AND typeof(manifestSourceEventWatermarkVersion) = 'integer' AND manifestSourceEventWatermarkVersion >= 1
          AND json_valid(manifestEventKindsCoveredJson)
          AND json_type(manifestEventKindsCoveredJson) = 'array'
          AND length(manifestEventKindsCoveredJson) <= 4096
          AND date(manifestCoveredStartDate) = manifestCoveredStartDate
          AND date(manifestCoveredEndDateExclusive) = manifestCoveredEndDateExclusive
          AND manifestCoveredStartDate < manifestCoveredEndDateExclusive
          AND length(manifestSourceHash) = 64
          AND manifestAuthorityStatus IN ('approved_by_reference', 'unresolved', 'rejected')
          AND (manifestPolicyRef IS NULL OR length(trim(manifestPolicyRef)) BETWEEN 1 AND 160)
          AND length(eventManifestHash) = 64)),
        CHECK (json_valid(policyBundleRefsJson)),
        CHECK (authorityStatus IN ('approved_by_reference', 'unresolved', 'rejected')),
        CHECK (completenessStatus IN ('complete', 'incomplete', 'missing')),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE} (
        id TEXT PRIMARY KEY,
        forecastRunId TEXT NOT NULL,
        inputSnapshotId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        rentalLineId TEXT NOT NULL,
        eventKind TEXT NOT NULL,
        sourceSystem TEXT NOT NULL,
        sourceId TEXT NOT NULL,
        sourceVersion INTEGER NOT NULL,
        sourceEventId TEXT NOT NULL,
        sourceEventVersion INTEGER NOT NULL,
        effectiveStartDate TEXT NOT NULL,
        effectiveEndDateExclusive TEXT NOT NULL,
        authorityStatus TEXT NOT NULL,
        authorityPolicyRef TEXT,
        evidenceHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (forecastRunId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (inputSnapshotId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (rentalLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_RENTAL_LINES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (eventKind IN ('rental_status', 'effective_terms', 'extension', 'return', 'downtime', 'calculation_policy', 'vat_policy', 'rounding_policy', 'confidence_policy', 'completeness_manifest')),
        CHECK (typeof(sourceVersion) = 'integer' AND sourceVersion >= 1),
        CHECK (typeof(sourceEventVersion) = 'integer' AND sourceEventVersion >= 1),
        CHECK (date(effectiveStartDate) = effectiveStartDate AND date(effectiveEndDateExclusive) = effectiveEndDateExclusive AND effectiveStartDate < effectiveEndDateExclusive),
        CHECK (authorityStatus IN ('approved_by_reference', 'unresolved', 'rejected')),
        CHECK ((authorityStatus = 'approved_by_reference' AND length(trim(authorityPolicyRef)) > 0) OR authorityStatus != 'approved_by_reference'),
        CHECK (length(evidenceHash) = 64),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${FORECAST_RECEIVABLE_ITEMS_TABLE} (
        id TEXT PRIMARY KEY,
        forecastRunId TEXT NOT NULL,
        inputSnapshotId TEXT NOT NULL,
        forecastCoverageKey TEXT NOT NULL,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        componentKind TEXT NOT NULL,
        clientId TEXT NOT NULL,
        contractId TEXT NOT NULL,
        rentalId TEXT NOT NULL,
        rentalLineId TEXT NOT NULL,
        effectiveTermsVersionId TEXT NOT NULL,
        coverageStartDate TEXT NOT NULL,
        coverageEndDateExclusive TEXT NOT NULL,
        currency TEXT NOT NULL,
        netAmountMinor INTEGER NOT NULL,
        vatAmountMinor INTEGER NOT NULL,
        grossAmountMinor INTEGER NOT NULL,
        calculationVersion TEXT NOT NULL,
        calculationPolicyRef TEXT NOT NULL,
        vatPolicyRef TEXT NOT NULL,
        roundingPolicyRef TEXT NOT NULL,
        policyDecisionRef TEXT NOT NULL,
        confidence TEXT NOT NULL,
        confidenceReasonCodesJson TEXT NOT NULL,
        normalizedCalculationEvidenceJson TEXT NOT NULL,
        itemSourceHash TEXT NOT NULL,
        itemResultHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (forecastRunId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (inputSnapshotId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (rentalLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_RENTAL_LINES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (effectiveTermsVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_EFFECTIVE_TERMS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (componentKind IN ('open_period_forecast', 'planned_future')),
        CHECK (date(coverageStartDate) = coverageStartDate AND date(coverageEndDateExclusive) = coverageEndDateExclusive AND coverageStartDate < coverageEndDateExclusive),
        CHECK (currency = 'RUB'),
        CHECK (typeof(netAmountMinor) = 'integer' AND netAmountMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(vatAmountMinor) = 'integer' AND vatAmountMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(grossAmountMinor) = 'integer' AND grossAmountMinor BETWEEN 0 AND 9007199254740991),
        CHECK (netAmountMinor + vatAmountMinor = grossAmountMinor),
        CHECK (confidence IN ('high', 'medium', 'low')),
        CHECK (json_valid(confidenceReasonCodesJson) AND json_array_length(confidenceReasonCodesJson) > 0),
        CHECK (json_valid(normalizedCalculationEvidenceJson) AND json_type(normalizedCalculationEvidenceJson) = 'object'),
        CHECK (length(forecastCoverageKey) = 64 AND length(itemSourceHash) = 64 AND length(itemResultHash) = 64),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE} (
        id TEXT PRIMARY KEY,
        forecastRunId TEXT NOT NULL,
        inputSnapshotId TEXT,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        rentalLineId TEXT,
        componentKind TEXT,
        affectedStartDate TEXT,
        affectedEndDateExclusive TEXT,
        severity TEXT NOT NULL,
        confidence TEXT NOT NULL,
        reasonCode TEXT NOT NULL,
        sourceIdentity TEXT,
        sourceHash TEXT,
        policyRef TEXT,
        correlationId TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (forecastRunId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (inputSnapshotId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (componentKind IS NULL OR componentKind IN ('open_period_forecast', 'planned_future')),
        CHECK ((affectedStartDate IS NULL AND affectedEndDateExclusive IS NULL)
          OR (date(affectedStartDate) = affectedStartDate AND date(affectedEndDateExclusive) = affectedEndDateExclusive AND affectedStartDate < affectedEndDateExclusive)),
        CHECK (severity IN ('info', 'warning', 'blocking')),
        CHECK (confidence = 'insufficient'),
        CHECK (length(trim(reasonCode)) > 0),
        CHECK (sourceHash IS NULL OR length(sourceHash) = 64),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${FORECAST_RECEIVABLE_OPERATIONS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        operationType TEXT NOT NULL,
        idempotencyKey TEXT NOT NULL,
        commandFingerprint TEXT NOT NULL,
        inputSetHash TEXT NOT NULL,
        planningSeriesKey TEXT NOT NULL,
        actorPrincipalId TEXT NOT NULL,
        actorMembershipId TEXT NOT NULL,
        actorMembershipVersion INTEGER NOT NULL,
        roleTemplateKey TEXT NOT NULL,
        roleTemplateVersion INTEGER NOT NULL,
        capabilityCatalogVersion INTEGER NOT NULL,
        capabilityKey TEXT NOT NULL,
        resultRunId TEXT NOT NULL,
        resultHash TEXT NOT NULL,
        auditEventId TEXT NOT NULL,
        correlationId TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        UNIQUE (auditEventId, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (actorMembershipId, companyId)
          REFERENCES company_memberships(id, companyId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (capabilityCatalogVersion, capabilityKey)
          REFERENCES capability_catalog_entries(catalogVersion, capabilityKey)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (resultRunId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (auditEventId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        CHECK (operationType = 'calculate_forecast_run'),
        CHECK (capabilityKey = 'forecast.calculate'),
        CHECK (typeof(actorMembershipVersion) = 'integer' AND actorMembershipVersion >= 1),
        CHECK (typeof(roleTemplateVersion) = 'integer' AND roleTemplateVersion >= 1),
        CHECK (length(commandFingerprint) = 64 AND length(inputSetHash) = 64 AND length(planningSeriesKey) = 64 AND length(resultHash) = 64),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE} (
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
        roleTemplateKey TEXT NOT NULL,
        roleTemplateVersion INTEGER NOT NULL,
        capabilityCatalogVersion INTEGER NOT NULL,
        capabilityKey TEXT NOT NULL,
        correlationId TEXT NOT NULL,
        reasonCode TEXT NOT NULL,
        reasonText TEXT NOT NULL,
        beforeFingerprint TEXT,
        afterFingerprint TEXT NOT NULL,
        inputSetHash TEXT NOT NULL,
        resultHash TEXT NOT NULL,
        operationId TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (operationId, companyId, branchId)
          REFERENCES ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (actorMembershipId, companyId)
          REFERENCES company_memberships(id, companyId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (capabilityCatalogVersion, capabilityKey)
          REFERENCES capability_catalog_entries(catalogVersion, capabilityKey)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (aggregateType = 'forecast_receivable_run' AND aggregateVersion = 1),
        CHECK (eventType = 'forecast_run_calculated' AND actorType = 'user'),
        CHECK (capabilityKey = 'forecast.calculate'),
        CHECK (length(trim(reasonCode)) > 0 AND length(trim(reasonText)) > 0),
        CHECK (beforeFingerprint IS NULL OR length(beforeFingerprint) = 64),
        CHECK (length(afterFingerprint) = 64 AND length(inputSetHash) = 64 AND length(resultHash) = 64),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE UNIQUE INDEX uq_forecast_run_operation
        ON ${FORECAST_RECEIVABLE_RUNS_TABLE}(operationId);
      CREATE UNIQUE INDEX uq_forecast_run_supersession_predecessor
        ON ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE}(predecessorRunId);
      CREATE UNIQUE INDEX uq_forecast_input_per_run_line_component_interval
        ON ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE}(forecastRunId, rentalLineId, componentKind, candidateStartDate, candidateEndDateExclusive);
      CREATE UNIQUE INDEX uq_forecast_event_source_identity
        ON ${FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE}(inputSnapshotId, eventKind, sourceSystem, sourceId, sourceVersion, sourceEventId, sourceEventVersion, effectiveStartDate, effectiveEndDateExclusive);
      CREATE UNIQUE INDEX uq_forecast_item_coverage
        ON ${FORECAST_RECEIVABLE_ITEMS_TABLE}(forecastRunId, forecastCoverageKey);
      CREATE UNIQUE INDEX uq_forecast_operation_identity
        ON ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}(companyId, operationType, idempotencyKey);
      CREATE UNIQUE INDEX uq_forecast_operation_result
        ON ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}(resultRunId);

      CREATE INDEX idx_forecast_current_runs
        ON ${FORECAST_RECEIVABLE_RUNS_TABLE}(companyId, branchId, planningSeriesKey, calculatedAt, id);
      CREATE INDEX idx_forecast_runs_scope
        ON ${FORECAST_RECEIVABLE_RUNS_TABLE}(companyId, branchId, asOfDate, calculatedAt, id);
      CREATE INDEX idx_forecast_items_scope
        ON ${FORECAST_RECEIVABLE_ITEMS_TABLE}(companyId, branchId, forecastRunId, componentKind, createdAt, id);
      CREATE INDEX idx_forecast_diagnostics_scope
        ON ${FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE}(companyId, branchId, forecastRunId, severity, createdAt, id);
      CREATE INDEX idx_forecast_supersession_successor
        ON ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE}(companyId, branchId, successorRunId, predecessorRunId);
      CREATE INDEX idx_forecast_inputs_scope
        ON ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE}(companyId, branchId, forecastRunId, rentalLineId, id);

      CREATE TRIGGER trg_forecast_run_supersession_validate
      BEFORE INSERT ON ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE}
      WHEN EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}
        WHERE id = NEW.operationId
      )
      OR EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE}
        WHERE predecessorRunId = NEW.predecessorRunId
      )
      OR NOT EXISTS (
        SELECT 1
        FROM ${FORECAST_RECEIVABLE_RUNS_TABLE} predecessor
        JOIN ${FORECAST_RECEIVABLE_RUNS_TABLE} successor
          ON successor.id = NEW.successorRunId
         AND successor.companyId = NEW.companyId
         AND successor.branchId = NEW.branchId
        WHERE predecessor.id = NEW.predecessorRunId
          AND predecessor.companyId = NEW.companyId
          AND predecessor.branchId = NEW.branchId
          AND predecessor.planningSeriesKey = NEW.planningSeriesKey
          AND successor.planningSeriesKey = NEW.planningSeriesKey
          AND successor.operationId = NEW.operationId
          AND predecessor.calculatedAt <= successor.calculatedAt
      )
      BEGIN
        SELECT RAISE(ABORT, 'forecast run supersession invalid');
      END;

      CREATE TRIGGER trg_forecast_input_snapshot_validate
      BEFORE INSERT ON ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE}
      WHEN EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}
        WHERE resultRunId = NEW.forecastRunId
      )
      OR NOT EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_RUNS_TABLE} run
        WHERE run.id = NEW.forecastRunId
          AND run.companyId = NEW.companyId
          AND run.branchId = NEW.branchId
          AND NEW.candidateStartDate >= run.horizonStartDate
          AND NEW.candidateEndDateExclusive <= run.horizonEndDateExclusive
          AND NEW.candidateStartDate >= NEW.serviceStartDate
          AND NEW.candidateEndDateExclusive <= NEW.serviceEndDateExclusive
      )
      BEGIN
        SELECT RAISE(ABORT, 'forecast input outside run horizon');
      END;

      CREATE TRIGGER trg_forecast_input_event_validate
      BEFORE INSERT ON ${FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE}
      WHEN EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}
        WHERE resultRunId = NEW.forecastRunId
      )
      OR NOT EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE} input
        WHERE input.id = NEW.inputSnapshotId
          AND input.forecastRunId = NEW.forecastRunId
          AND input.companyId = NEW.companyId
          AND input.branchId = NEW.branchId
          AND input.rentalLineId = NEW.rentalLineId
      )
      BEGIN
        SELECT RAISE(ABORT, 'forecast input event scope mismatch');
      END;

      CREATE TRIGGER trg_forecast_item_validate
      BEFORE INSERT ON ${FORECAST_RECEIVABLE_ITEMS_TABLE}
      WHEN EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}
        WHERE resultRunId = NEW.forecastRunId
      )
      OR NOT EXISTS (
        SELECT 1
        FROM ${FORECAST_RECEIVABLE_RUNS_TABLE} run
        JOIN ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE} input
          ON input.id = NEW.inputSnapshotId
         AND input.forecastRunId = run.id
         AND input.companyId = run.companyId
         AND input.branchId = run.branchId
        WHERE run.id = NEW.forecastRunId
          AND run.companyId = NEW.companyId
          AND run.branchId = NEW.branchId
          AND input.rentalLineId = NEW.rentalLineId
          AND input.effectiveTermsVersionId = NEW.effectiveTermsVersionId
          AND input.componentKind = NEW.componentKind
          AND input.clientId = NEW.clientId
          AND input.contractId = NEW.contractId
          AND input.rentalId = NEW.rentalId
          AND NEW.coverageStartDate >= run.horizonStartDate
          AND NEW.coverageEndDateExclusive <= run.horizonEndDateExclusive
          AND NEW.coverageStartDate >= input.candidateStartDate
          AND NEW.coverageEndDateExclusive <= input.candidateEndDateExclusive
          AND ((NEW.componentKind = 'open_period_forecast' AND input.rentalStatus IN ('active', 'return_planned'))
            OR (NEW.componentKind = 'planned_future' AND input.rentalStatus = 'planned_future'))
      )
      BEGIN
        SELECT RAISE(ABORT, 'forecast item lineage invalid');
      END;

      CREATE TRIGGER trg_forecast_item_no_overlap
      BEFORE INSERT ON ${FORECAST_RECEIVABLE_ITEMS_TABLE}
      WHEN EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE} existing
        WHERE existing.forecastRunId = NEW.forecastRunId
          AND existing.companyId = NEW.companyId
          AND existing.branchId = NEW.branchId
          AND existing.rentalLineId = NEW.rentalLineId
          AND existing.componentKind = NEW.componentKind
          AND existing.coverageStartDate < NEW.coverageEndDateExclusive
          AND NEW.coverageStartDate < existing.coverageEndDateExclusive
      )
      BEGIN
        SELECT RAISE(ABORT, 'forecast item coverage overlap');
      END;

      CREATE TRIGGER trg_forecast_diagnostic_validate
      BEFORE INSERT ON ${FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE}
      WHEN EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}
        WHERE resultRunId = NEW.forecastRunId
      )
      OR (NEW.inputSnapshotId IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE} input
        WHERE input.id = NEW.inputSnapshotId
          AND input.forecastRunId = NEW.forecastRunId
          AND input.companyId = NEW.companyId
          AND input.branchId = NEW.branchId
          AND input.rentalLineId = NEW.rentalLineId
          AND input.componentKind = NEW.componentKind
          AND NEW.affectedStartDate >= input.candidateStartDate
          AND NEW.affectedEndDateExclusive <= input.candidateEndDateExclusive
          AND input.sourceIdentity = NEW.sourceIdentity
          AND input.sourceHash = NEW.sourceHash
      ))
      OR (NEW.inputSnapshotId IS NULL AND (
        NEW.rentalLineId IS NOT NULL
        OR NEW.componentKind IS NOT NULL
        OR NEW.affectedStartDate IS NOT NULL
        OR NEW.affectedEndDateExclusive IS NOT NULL
        OR NEW.sourceIdentity IS NOT NULL
        OR NEW.sourceHash IS NOT NULL
      ))
      BEGIN
        SELECT RAISE(ABORT, 'forecast diagnostic lineage invalid');
      END;

      CREATE TRIGGER trg_forecast_operation_finalize_run
      BEFORE INSERT ON ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}
      WHEN NOT EXISTS (
        SELECT 1 FROM ${FORECAST_RECEIVABLE_RUNS_TABLE} run
        WHERE run.id = NEW.resultRunId
          AND run.companyId = NEW.companyId
          AND run.branchId = NEW.branchId
          AND run.operationId = NEW.id
          AND run.planningSeriesKey = NEW.planningSeriesKey
          AND run.inputSetHash = NEW.inputSetHash
          AND run.resultHash = NEW.resultHash
          AND run.correlationId = NEW.correlationId
          AND run.inputSnapshotCount = (SELECT COUNT(*) FROM ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE} input WHERE input.forecastRunId = run.id)
          AND run.inputEventCount = (SELECT COUNT(*) FROM ${FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE} event WHERE event.forecastRunId = run.id)
          AND run.inputCompletenessManifestCount = (SELECT COUNT(*) FROM ${FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE} input WHERE input.forecastRunId = run.id AND input.completenessManifestPresent = 1)
          AND run.itemCount = (SELECT COUNT(*) FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE} item WHERE item.forecastRunId = run.id)
          AND run.diagnosticCount = (SELECT COUNT(*) FROM ${FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE} diagnostic WHERE diagnostic.forecastRunId = run.id)
          AND run.blockingDiagnosticCount = (SELECT COUNT(*) FROM ${FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE} diagnostic WHERE diagnostic.forecastRunId = run.id AND diagnostic.severity = 'blocking')
          AND run.openPeriodForecastNetMinor = COALESCE((SELECT SUM(item.netAmountMinor) FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE} item WHERE item.forecastRunId = run.id AND item.componentKind = 'open_period_forecast'), 0)
          AND run.openPeriodForecastVatMinor = COALESCE((SELECT SUM(item.vatAmountMinor) FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE} item WHERE item.forecastRunId = run.id AND item.componentKind = 'open_period_forecast'), 0)
          AND run.openPeriodForecastGrossMinor = COALESCE((SELECT SUM(item.grossAmountMinor) FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE} item WHERE item.forecastRunId = run.id AND item.componentKind = 'open_period_forecast'), 0)
          AND run.plannedFutureNetMinor = COALESCE((SELECT SUM(item.netAmountMinor) FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE} item WHERE item.forecastRunId = run.id AND item.componentKind = 'planned_future'), 0)
          AND run.plannedFutureVatMinor = COALESCE((SELECT SUM(item.vatAmountMinor) FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE} item WHERE item.forecastRunId = run.id AND item.componentKind = 'planned_future'), 0)
          AND run.plannedFutureGrossMinor = COALESCE((SELECT SUM(item.grossAmountMinor) FROM ${FORECAST_RECEIVABLE_ITEMS_TABLE} item WHERE item.forecastRunId = run.id AND item.componentKind = 'planned_future'), 0)
          AND run.predecessorCount = (SELECT COUNT(*) FROM ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE} lifecycle WHERE lifecycle.successorRunId = run.id)
          AND NOT EXISTS (
            SELECT 1 FROM ${FORECAST_RECEIVABLE_RUNS_TABLE} other
            WHERE other.companyId = run.companyId
              AND other.branchId = run.branchId
              AND other.planningSeriesKey = run.planningSeriesKey
              AND other.id != run.id
              AND NOT EXISTS (
                SELECT 1 FROM ${FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE} lifecycle
                WHERE lifecycle.predecessorRunId = other.id
              )
          )
      )
      BEGIN
        SELECT RAISE(ABORT, 'forecast run result or lifecycle incomplete');
      END;

      ${FORECAST_RECEIVABLES_PLANNING_TABLES.map(immutableTriggersSql).join('\n')}

      CREATE TRIGGER trg_forecast_receivable_operations_no_replace
      BEFORE INSERT ON ${FORECAST_RECEIVABLE_OPERATIONS_TABLE}
      WHEN EXISTS (SELECT 1 FROM ${FORECAST_RECEIVABLE_OPERATIONS_TABLE} WHERE id = NEW.id)
      BEGIN
        SELECT RAISE(ABORT, 'forecast operations are append-only');
      END;

      CREATE TRIGGER trg_forecast_receivable_audit_events_no_replace
      BEFORE INSERT ON ${FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE}
      WHEN EXISTS (SELECT 1 FROM ${FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE} WHERE id = NEW.id)
      BEGIN
        SELECT RAISE(ABORT, 'forecast audit events are append-only');
      END;
    `);

    assertForecastReceivablesPlanningStructure(db, { requireMigration: false });
    db.prepare(`
      INSERT INTO sql_shadow_schema_migrations (name, version)
      VALUES (?, ?)
    `).run(FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID, FORECAST_RECEIVABLES_PLANNING_SCHEMA_VERSION);
    return true;
  });

  return migrate.immediate();
}

module.exports = {
  FORECAST_RECEIVABLE_AUDIT_EVENTS_TABLE,
  FORECAST_RECEIVABLE_DIAGNOSTICS_TABLE,
  FORECAST_RECEIVABLE_INPUT_EVENTS_TABLE,
  FORECAST_RECEIVABLE_INPUT_SNAPSHOTS_TABLE,
  FORECAST_RECEIVABLE_ITEMS_TABLE,
  FORECAST_RECEIVABLE_OPERATIONS_TABLE,
  FORECAST_RECEIVABLE_RUNS_TABLE,
  FORECAST_RECEIVABLE_RUN_SUPERSESSIONS_TABLE,
  FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID,
  FORECAST_RECEIVABLES_PLANNING_SCHEMA_VERSION,
  FORECAST_RECEIVABLES_PLANNING_TABLES,
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
  REQUIRED_TRIGGERS,
  assertForecastReceivablesPlanningStructure,
  ensureForecastReceivablesPlanningSchema,
};
