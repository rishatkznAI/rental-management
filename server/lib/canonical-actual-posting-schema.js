const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
  CANONICAL_RECEIVABLES_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SCHEMA_VERSION,
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
} = require('./canonical-receivables-schema');
const {
  CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION,
} = require('./canonical-receivables-settlement-schema');
const {
  CAPABILITY_CATALOG_ENTRIES_TABLE,
  CAPABILITY_CATALOG_V1,
  CAPABILITY_CATALOG_VERSIONS_TABLE,
  FINANCIAL_TABLES,
  PLATFORM_IDENTITY_MIGRATION_ID,
  PLATFORM_IDENTITY_SCHEMA_VERSION,
  PLATFORM_IDENTITY_TABLES,
  assertPlatformIdentityStructure,
} = require('./platform-identity-schema');
const {
  BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE,
  BILLING_SOURCE_AUTHORITY_MIGRATION_ID,
  BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
  BILLING_SOURCE_AUTHORITY_TABLES,
  BILLING_SOURCE_COVERAGE_SETS_TABLE,
  BILLING_SOURCE_COVERAGE_SLICES_TABLE,
  BILLING_SOURCE_PERIODS_TABLE,
  BILLING_SOURCE_PERIOD_VERSIONS_TABLE,
  BILLING_SOURCE_RENTAL_LINES_TABLE,
  BILLING_SOURCE_SNAPSHOTS_TABLE,
  BILLING_SOURCE_UPDS_TABLE,
  BILLING_SOURCE_UPD_LINES_TABLE,
  BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE,
  BILLING_SOURCE_UPD_VERSIONS_TABLE,
  assertBillingSourceAuthorityStructure,
} = require('./billing-source-authority-schema');
const {
  FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID,
  FORECAST_RECEIVABLES_PLANNING_SCHEMA_VERSION,
  FORECAST_RECEIVABLES_PLANNING_TABLES,
  assertForecastReceivablesPlanningStructure,
} = require('./forecast-receivables-planning-schema');
const {
  ACTUAL_SOURCE_DRY_RUNS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE,
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID,
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_SCHEMA_VERSION,
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES,
  assertActualSourceEligibilityDryRunStructure,
} = require('./actual-source-eligibility-dry-run-schema');

const CANONICAL_ACTUAL_POSTING_SCHEMA_VERSION = 1;
const CANONICAL_ACTUAL_POSTING_MIGRATION_ID = 'canonical_actual_posting_pr9';

const GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE = 'governed_adapter_authority_records';
const CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE = 'canonical_write_authorization_records';
const CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE = 'canonical_posting_activation_records';
const ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE = 'actual_receivable_eligible_events';
const CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE = 'canonical_receivable_posting_operations';
const CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE = 'canonical_receivable_posting_conflicts';
const CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE = 'canonical_receivable_posting_conflict_transitions';

const CANONICAL_ACTUAL_POSTING_TABLES = Object.freeze([
  GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE,
  CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
  CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
  ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE,
]);

const AUTHORITY_CONFLICT_PREFIXES = Object.freeze([
  'SOURCE_ADAPTER',
  'ELIGIBILITY_PRODUCER',
  'CANONICAL_POSTING_ADAPTER',
]);
const AUTHORITY_CONFLICT_SUFFIXES = Object.freeze([
  'NOT_YET_EFFECTIVE',
  'EXPIRED',
  'REVOKED',
  'SUPERSEDED',
  'RECORD_HASH_MISMATCH',
  'ARTIFACT_IDENTITY_DRIFT',
  'CONFIGURATION_HASH_DRIFT',
  'POLICY_HASH_DRIFT',
  'SCOPE_MISMATCH',
  'OWNERSHIP_MANIFEST_MISMATCH',
  'LATEST_CHAIN_MISMATCH',
]);
const NON_AUTHORITY_CONFLICT_TYPES = Object.freeze([
  'AUTHORIZATION_DRIFT',
  'ACTIVATION_DRIFT',
  'SOURCE_LINEAGE_ROOT_CONFLICT',
  'SOURCE_LINEAGE_BROKEN_SUCCESSOR',
  'SOURCE_LINEAGE_NO_CURRENT_REVISION',
  'SOURCE_LINEAGE_MULTIPLE_CURRENT_REVISIONS',
  'SOURCE_CORRECTION_AFTER_POSTING',
  'SOURCE_CORRECTION_AFTER_ELIGIBILITY',
  'SOURCE_REVISION_CHANGED_BEFORE_POSTING',
  'PR6_LINEAGE_DRIFT',
  'PR8_EVIDENCE_MISMATCH',
  'DUE_DATE_POLICY_DRIFT',
  'COMPANY_TIMEZONE_DRIFT',
  'IDEMPOTENCY_CONTENT_CONFLICT',
  'AUDIT_SEAL_MISMATCH',
  'ECONOMIC_SOURCE_EVENT_MISMATCH',
]);
const CANONICAL_POSTING_CONFLICT_TYPES = Object.freeze([
  ...NON_AUTHORITY_CONFLICT_TYPES,
  ...AUTHORITY_CONFLICT_PREFIXES.flatMap(prefix => (
    AUTHORITY_CONFLICT_SUFFIXES.map(suffix => `${prefix}_${suffix}`)
  )),
]);

const REQUIRED_COLUMNS = Object.freeze({
  [GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE]: [
    'recordId', 'authorityId', 'authorityVersion', 'previousRecordId', 'authorityKind',
    'status', 'environment', 'actorId', 'companyId', 'branchId', 'sourceSystemIdsJson',
    'sourceRowClassesJson', 'allowedOperation', 'artifactDigest', 'sourceCommitSha',
    'configurationHash', 'policyHash', 'sourceOwnershipManifestHash', 'credentialType',
    'credentialFingerprint', 'credentialIssuerRef', 'effectiveFrom', 'expiresAt',
    'ownerRef', 'approvalRef', 'approvalHash', 'revocationReasonCode', 'recordHash',
    'schemaVersion', 'createdAt',
  ],
  [CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE]: [
    'recordId', 'authorizationId', 'authorizationVersion', 'previousRecordId', 'status',
    'companyId', 'branchId', 'activationBoundaryId', 'activationCohortRef', 'cohortHash',
    'boundaryHash', 'sourceSystemIdsJson', 'sourceAdapterAuthorityRecordId',
    'sourceAdapterAuthorityVersion', 'sourceAdapterAuthorityRecordHash',
    'sourceOwnershipManifestHash', 'producerAuthorityRecordId', 'producerAuthorityVersion',
    'producerAuthorityRecordHash', 'producerAuthorityCompanyId', 'producerAuthorityBranchId',
    'producerAuthorityKind', 'postingAdapterAuthorityRecordId',
    'postingAdapterAuthorityVersion', 'postingAdapterAuthorityRecordHash',
    'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityBranchId',
    'postingAdapterAuthorityKind', 'eventSchemaVersion', 'operationType',
    'primaryEffectTablesJson', 'denialEvidenceTable', 'denialEvidencePermission',
    'denialTransitionTable', 'denialTransitionPermission', 'forbiddenOperationsJson',
    'policyManifestHashesJson', 'evidencePackHash', 'acceptedDryRunsJson',
    'acceptedDryRunsHash', 'acceptedPr8EvidenceJson', 'acceptedPr8EvidenceHash',
    'acceptedCompanyTimezoneSnapshot', 'acceptedFreshnessWindowsHash',
    'amountBasisPolicyRef', 'amountBasisPolicyHash', 'dueDatePolicySetJson',
    'dueDatePolicySetHash', 'operationalControlRef', 'retentionControlRef',
    'backupEvidenceRef', 'approvalSetJson', 'effectiveFrom', 'expiresAt',
    'revocationReasonCode', 'recordHash', 'schemaVersion', 'createdAt',
  ],
  [CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE]: [
    'recordId', 'activationId', 'activationVersion', 'previousRecordId', 'status',
    'companyId', 'branchId', 'activationBoundaryId', 'forwardOnlyStartDate',
    'forwardOnlyStartUtc', 'boundaryEndUtc', 'companyTimezoneSnapshot',
    'sourceSystemIdsJson', 'allowedDocumentClassesJson', 'allowedRentalClassesJson',
    'currency', 'explicitExclusionsJson', 'cohortHash', 'boundaryHash',
    'policyManifestHashesJson', 'acceptedDryRunsHash', 'acceptedPr8EvidenceHash',
    'acceptedFreshnessWindowsHash', 'dueDatePolicySetJson', 'dueDatePolicySetHash',
    'postingAdapterAuthorityRecordId', 'postingAdapterAuthorityVersion',
    'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityCompanyId',
    'postingAdapterAuthorityBranchId', 'postingAdapterAuthorityKind',
    'writeAuthorizationRecordId', 'effectiveFrom', 'expiresAt', 'approvalRef',
    'approvalHash', 'revocationReasonCode', 'recordHash', 'schemaVersion', 'createdAt',
  ],
  [ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE]: [
    'id', 'companyId', 'branchId', 'economicLineageKey', 'economicSourceRevisionKey',
    'rootSourceDocumentLineageId', 'rootCoverageLineageId', 'currentPr6RevisionHash',
    'eventSchemaVersion', 'eventVersion', 'dryRunId', 'candidateId', 'candidateResultHash',
    'completeInputSetHash', 'policyManifestHash', 'sourceOwnershipManifestHash',
    'acceptedDryRunsHash', 'acceptedPr8EvidenceHash', 'activationBoundaryId',
    'activationRecordId', 'activationCohortRef', 'cohortHash', 'periodId',
    'closedPeriodVersionId', 'snapshotId', 'updId', 'formedUpdVersionId',
    'conductedUpdVersionId', 'updLineId', 'updLineVersionId', 'coverageSetId',
    'coverageSliceId', 'clientId', 'contractId', 'rentalId', 'rentalLineId',
    'sliceStartDate', 'sliceEndDateExclusive', 'currency', 'companyTimezoneSnapshot',
    'netAmountMinor', 'vatAmountMinor', 'grossAmountMinor', 'originalAmountMinor',
    'amountBasis', 'amountBasisPolicyRef', 'amountBasisPolicyHash', 'contractualDueDate',
    'dueDateProvenance', 'dueDateEvidenceRef', 'dueDatePolicySetHash',
    'selectedDueDateGateKind', 'selectedDueDatePolicyId', 'selectedDueDatePolicyVersion',
    'selectedDueDatePolicyHash', 'dueDateTreatment',
    'unknownDueDateTreatmentMappingId', 'unknownDueDateTreatmentMappingVersion',
    'unknownDueDateTreatmentMappingHash', 'sourceAdapterAuthorityRecordId',
    'sourceAdapterAuthorityVersion', 'sourceAdapterAuthorityRecordHash',
    'producerAuthorityRecordId', 'producerAuthorityVersion', 'producerAuthorityRecordHash',
    'producerAuthorityCompanyId', 'producerAuthorityBranchId', 'producerAuthorityKind',
    'writeAuthorizationRecordId', 'sourceLineageHash', 'correlationId', 'eventHash',
    'schemaVersion', 'occurredAt', 'createdAt',
  ],
  [CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE]: [
    'id', 'companyId', 'branchId', 'operationType', 'idempotencyKey', 'eventId',
    'eventHash', 'economicLineageKey', 'economicSourceRevisionKey',
    'currentPr6RevisionHash', 'sourceAdapterAuthorityRecordId',
    'sourceAdapterAuthorityVersion', 'sourceAdapterAuthorityRecordHash',
    'sourceOwnershipManifestHash', 'postingAdapterAuthorityRecordId',
    'postingAdapterAuthorityVersion', 'postingAdapterAuthorityRecordHash',
    'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityBranchId',
    'postingAdapterAuthorityKind', 'writeAuthorizationRecordId', 'activationRecordId',
    'acceptedDryRunsHash', 'acceptedPr8EvidenceHash', 'dueDatePolicySetHash',
    'selectedDueDateGateKind', 'selectedDueDatePolicyId', 'selectedDueDatePolicyVersion',
    'selectedDueDatePolicyHash', 'dueDateTreatment', 'unknownDueDateTreatmentMappingId',
    'unknownDueDateTreatmentMappingVersion', 'unknownDueDateTreatmentMappingHash',
    'canonicalReceivableId', 'canonicalReceivableFingerprint', 'sourceLineageHash',
    'commandFingerprint', 'auditPayloadFingerprint', 'auditEventFingerprint',
    'resultHash', 'financialAuditEventId', 'correlationId', 'schemaVersion', 'createdAt',
  ],
  [CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE]: [
    'id', 'companyId', 'branchId', 'conflictType', 'severity', 'eventId', 'eventHash',
    'economicLineageKey', 'economicSourceRevisionKey',
    'economicLineageCandidateFingerprint', 'existingReceivableId',
    'existingOperationId', 'conflictObservationJson', 'conflictObservationHash',
    'expectedFingerprint', 'observedFingerprint', 'sourceAdapterAuthorityRecordId',
    'sourceAdapterAuthorityVersion', 'sourceAdapterAuthorityRecordHash',
    'sourceOwnershipManifestHash', 'producerAuthorityRecordId',
    'producerAuthorityVersion', 'producerAuthorityRecordHash',
    'producerAuthorityCompanyId', 'producerAuthorityBranchId', 'producerAuthorityKind',
    'postingAdapterAuthorityRecordId', 'postingAdapterAuthorityVersion',
    'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityCompanyId',
    'postingAdapterAuthorityBranchId', 'postingAdapterAuthorityKind',
    'writeAuthorizationRecordId', 'activationRecordId', 'acceptedDryRunsHash',
    'acceptedPr8EvidenceHash', 'sourceLineageHash', 'deniedAuthorityKind',
    'deniedAuthorityRecordId', 'deniedAuthorityVersion', 'deniedAuthorityRecordHash',
    'denialAttemptId', 'deniedAttemptedAt', 'evidenceAttemptedAt',
    'sourceAuthorityChainSnapshotJson', 'sourceAuthorityChainSnapshotHash',
    'producerAuthorityChainSnapshotJson', 'producerAuthorityChainSnapshotHash',
    'postingAuthorityChainSnapshotJson', 'postingAuthorityChainSnapshotHash',
    'correlationId', 'detectorVersion', 'conflictHash', 'transitionId', 'schemaVersion',
    'detectedAt', 'createdAt',
  ],
  [CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE]: [
    'transitionId', 'conflictId', 'companyId', 'branchId', 'operationDomain',
    'scopeSequence', 'transitionKind', 'denialAttemptId', 'conflictHash', 'conflictType',
    'circuitRule', 'attemptAccountingKey', 'rateAccountingKey', 'circuitTransitionKey',
    'state', 'attemptApplied', 'attemptResultJson', 'attemptResultHash', 'rateApplied',
    'rateResultJson', 'rateResultHash', 'circuitApplied', 'circuitResultJson',
    'circuitResultHash', 'intentHash', 'schemaVersion', 'createdAt',
  ],
});

const EXPECTED_INDEX_DEFINITIONS = Object.freeze({
  uq_pr9_adapter_authority_version: `CREATE UNIQUE INDEX uq_pr9_adapter_authority_version
    ON ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}(companyId, branchId, authorityKind, authorityId, authorityVersion);`,
  uq_pr9_adapter_authority_hash: `CREATE UNIQUE INDEX uq_pr9_adapter_authority_hash
    ON ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}(recordHash);`,
  uq_pr9_adapter_authority_source_binding: `CREATE UNIQUE INDEX uq_pr9_adapter_authority_source_binding
    ON ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}(recordId, authorityVersion, recordHash, companyId, branchId);`,
  uq_pr9_adapter_authority_binding: `CREATE UNIQUE INDEX uq_pr9_adapter_authority_binding
    ON ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}(companyId, branchId, authorityKind, recordId, authorityVersion, recordHash);`,
  uq_pr9_adapter_authority_chain_parent: `CREATE UNIQUE INDEX uq_pr9_adapter_authority_chain_parent
    ON ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}(recordId, companyId, branchId, authorityKind, authorityId);`,
  idx_pr9_adapter_authority_scope: `CREATE INDEX idx_pr9_adapter_authority_scope
    ON ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}(companyId, branchId, authorityKind, authorityId, status, expiresAt);`,
  uq_pr9_write_authorization_version: `CREATE UNIQUE INDEX uq_pr9_write_authorization_version
    ON ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE}(authorizationId, authorizationVersion);`,
  uq_pr9_write_authorization_hash: `CREATE UNIQUE INDEX uq_pr9_write_authorization_hash
    ON ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE}(recordHash);`,
  idx_pr9_write_authorization_scope: `CREATE INDEX idx_pr9_write_authorization_scope
    ON ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE}(companyId, branchId, status, expiresAt);`,
  uq_pr9_activation_version: `CREATE UNIQUE INDEX uq_pr9_activation_version
    ON ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE}(activationId, activationVersion);`,
  uq_pr9_activation_hash: `CREATE UNIQUE INDEX uq_pr9_activation_hash
    ON ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE}(recordHash);`,
  idx_pr9_activation_scope: `CREATE INDEX idx_pr9_activation_scope
    ON ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE}(companyId, branchId, status, expiresAt);`,
  uq_pr9_eligible_economic_lineage: `CREATE UNIQUE INDEX uq_pr9_eligible_economic_lineage
    ON ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}(companyId, branchId, economicLineageKey);`,
  uq_pr9_eligible_source_revision: `CREATE UNIQUE INDEX uq_pr9_eligible_source_revision
    ON ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}(companyId, branchId, economicSourceRevisionKey);`,
  uq_pr9_eligible_event_hash: `CREATE UNIQUE INDEX uq_pr9_eligible_event_hash
    ON ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}(companyId, eventHash);`,
  uq_pr9_eligible_candidate: `CREATE UNIQUE INDEX uq_pr9_eligible_candidate
    ON ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}(dryRunId, candidateId);`,
  idx_pr9_eligible_scope: `CREATE INDEX idx_pr9_eligible_scope
    ON ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}(companyId, branchId, createdAt);`,
  uq_pr9_posting_operation_idempotency: `CREATE UNIQUE INDEX uq_pr9_posting_operation_idempotency
    ON ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}(companyId, operationType, idempotencyKey);`,
  uq_pr9_posting_operation_event: `CREATE UNIQUE INDEX uq_pr9_posting_operation_event
    ON ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}(eventId);`,
  uq_pr9_posting_operation_lineage: `CREATE UNIQUE INDEX uq_pr9_posting_operation_lineage
    ON ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}(companyId, branchId, economicLineageKey);`,
  uq_pr9_posting_operation_receivable: `CREATE UNIQUE INDEX uq_pr9_posting_operation_receivable
    ON ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}(canonicalReceivableId);`,
  uq_pr9_posting_operation_audit: `CREATE UNIQUE INDEX uq_pr9_posting_operation_audit
    ON ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}(financialAuditEventId);`,
  idx_pr9_posting_operation_scope: `CREATE INDEX idx_pr9_posting_operation_scope
    ON ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}(companyId, branchId, createdAt);`,
  uq_pr9_posting_conflict_hash: `CREATE UNIQUE INDEX uq_pr9_posting_conflict_hash
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE}(companyId, conflictHash);`,
  uq_pr9_posting_conflict_denial_attempt: `CREATE UNIQUE INDEX uq_pr9_posting_conflict_denial_attempt
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE}(denialAttemptId);`,
  uq_pr9_posting_conflict_transition_id: `CREATE UNIQUE INDEX uq_pr9_posting_conflict_transition_id
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE}(transitionId);`,
  idx_pr9_posting_conflict_scope: `CREATE INDEX idx_pr9_posting_conflict_scope
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE}(companyId, branchId, detectedAt);`,
  uq_pr9_posting_conflict_transition_parent: `CREATE UNIQUE INDEX uq_pr9_posting_conflict_transition_parent
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE}(id, companyId, branchId, denialAttemptId, conflictHash);`,
  uq_pr9_conflict_transition_reciprocal_parent: `CREATE UNIQUE INDEX uq_pr9_conflict_transition_reciprocal_parent
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}(transitionId, conflictId, companyId, branchId, denialAttemptId, conflictHash);`,
  uq_pr9_conflict_transition_conflict: `CREATE UNIQUE INDEX uq_pr9_conflict_transition_conflict
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}(conflictId);`,
  uq_pr9_conflict_transition_attempt: `CREATE UNIQUE INDEX uq_pr9_conflict_transition_attempt
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}(denialAttemptId);`,
  uq_pr9_conflict_transition_hash: `CREATE UNIQUE INDEX uq_pr9_conflict_transition_hash
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}(companyId, conflictHash);`,
  uq_pr9_conflict_transition_scope_sequence: `CREATE UNIQUE INDEX uq_pr9_conflict_transition_scope_sequence
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}(companyId, branchId, operationDomain, scopeSequence);`,
  uq_pr9_conflict_transition_attempt_key: `CREATE UNIQUE INDEX uq_pr9_conflict_transition_attempt_key
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}(attemptAccountingKey);`,
  uq_pr9_conflict_transition_rate_key: `CREATE UNIQUE INDEX uq_pr9_conflict_transition_rate_key
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}(rateAccountingKey);`,
  uq_pr9_conflict_transition_circuit_key: `CREATE UNIQUE INDEX uq_pr9_conflict_transition_circuit_key
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}(circuitTransitionKey);`,
  idx_pr9_conflict_transition_recovery_scope: `CREATE INDEX idx_pr9_conflict_transition_recovery_scope
    ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}(companyId, branchId, operationDomain, state, scopeSequence);`,
  uq_pr9_financial_audit_scope_parent: `CREATE UNIQUE INDEX uq_pr9_financial_audit_scope_parent
    ON ${FINANCIAL_AUDIT_EVENTS_TABLE}(id, companyId, branchId);`,
});

const REQUIRED_INDEXES = Object.freeze(Object.keys(EXPECTED_INDEX_DEFINITIONS));

function isAsciiIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value))) return false;
  return true;
}

function sameBoundedSqliteIdentifier(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  if (isAsciiIdentifier(leftText) && isAsciiIdentifier(rightText)) {
    return leftText.toLowerCase() === rightText.toLowerCase();
  }
  return leftText === rightText;
}

function sqliteMasterObject(db, type, name) {
  const rows = db.prepare('SELECT name, tbl_name, sql FROM sqlite_master WHERE type = ?').all(type)
    .filter(row => sameBoundedSqliteIdentifier(row.name, name));
  return rows.length === 1 ? rows[0] : null;
}

function tableExists(db, table) {
  return sqliteMasterObject(db, 'table', table) != null;
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
    throw new Error(`CANONICAL_PR9_PREREQUISITE_REQUIRED:${name}:v${version}`);
  }
}

function assertForeignKeysEnabled(db) {
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('CANONICAL_PR9_FOREIGN_KEYS_REQUIRED');
  }
}

function assertForeignKeyCheckClean(db) {
  const failures = db.pragma('foreign_key_check');
  if (failures.length > 0) {
    throw new Error(`CANONICAL_PR9_FOREIGN_KEY_CHECK_FAILED:${JSON.stringify(failures)}`);
  }
}

function assertNoCompetingRoots(db) {
  for (const table of ['companies', 'branches']) {
    if (tableExists(db, table)) throw new Error(`CANONICAL_PR9_COMPETING_AUTHORITY:${table}`);
  }
}

function assertCapabilityCatalogExact(db) {
  const versions = db.prepare(`
    SELECT version, status FROM ${CAPABILITY_CATALOG_VERSIONS_TABLE} ORDER BY version
  `).all();
  if (versions.length !== 1 || Number(versions[0].version) !== 1 || versions[0].status !== 'active') {
    throw new Error('CANONICAL_PR9_CAPABILITY_CATALOG_MISMATCH');
  }
  const actual = db.prepare(`
    SELECT capabilityKey, scopeKind, assignable, status
    FROM ${CAPABILITY_CATALOG_ENTRIES_TABLE}
    WHERE catalogVersion = 1
    ORDER BY capabilityKey
  `).all();
  const expected = CAPABILITY_CATALOG_V1.map(entry => ({
    capabilityKey: entry.key,
    scopeKind: entry.scopeKind,
    assignable: entry.assignable ? 1 : 0,
    status: 'active',
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('CANONICAL_PR9_CAPABILITY_CATALOG_MISMATCH');
  }
}

const ZERO_ROW_PREREQUISITES = Object.freeze([
  ...new Set([
    ...FINANCIAL_TABLES,
    CANONICAL_COMPANIES_TABLE,
    CANONICAL_BRANCHES_TABLE,
    ...PLATFORM_IDENTITY_TABLES.filter(table => (
      table !== CAPABILITY_CATALOG_VERSIONS_TABLE
      && table !== CAPABILITY_CATALOG_ENTRIES_TABLE
    )),
    ...BILLING_SOURCE_AUTHORITY_TABLES,
    ...FORECAST_RECEIVABLES_PLANNING_TABLES,
    ...ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES,
  ]),
]);

function assertFirstApplicationTablesEmpty(db) {
  for (const table of ZERO_ROW_PREREQUISITES) {
    if (!tableExists(db, table)) throw new Error(`CANONICAL_PR9_PREREQUISITE_TABLE_MISSING:${table}`);
    const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    if (count !== 0) throw new Error(`CANONICAL_PR9_PREREQUISITE_ROWS_PRESENT:${table}:${count}`);
  }
}

function hasUnexpectedPartialState(db) {
  if (CANONICAL_ACTUAL_POSTING_TABLES.some(table => tableExists(db, table))) return true;
  return db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE name LIKE 'uq_pr9_%'
       OR name LIKE 'idx_pr9_%'
       OR name LIKE 'trg_pr9_%'
       OR name LIKE 'trg_governed_adapter_authority_records_%'
       OR name LIKE 'trg_canonical_write_authorization_records_%'
       OR name LIKE 'trg_canonical_posting_activation_records_%'
       OR name LIKE 'trg_actual_receivable_eligible_events_%'
       OR name LIKE 'trg_canonical_receivable_posting_operations_%'
       OR name LIKE 'trg_canonical_receivable_posting_conflicts_%'
       OR name LIKE 'trg_canonical_receivable_posting_conflict_transitions_%'
    LIMIT 1
  `).get() != null;
}

function commonScopeForeignKeys() {
  return `
    FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (companyId, branchId) REFERENCES ${CANONICAL_BRANCHES_TABLE}(companyId, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  `;
}

function commonScopeChecks() {
  return `
    CHECK (length(trim(companyId)) > 0),
    CHECK (length(trim(branchId)) > 0),
    CHECK (lower(branchId) NOT IN ('*', 'all', 'global', 'company-wide', 'company_wide', 'any', 'null'))
  `;
}

function hashCheck(column) {
  return `CHECK (length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*')`;
}

function nullableHashCheck(column) {
  return `CHECK (${column} IS NULL OR (length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'))`;
}

function timestampCheck(column) {
  return `CHECK (${column} GLOB '????-??-??T??:??:??.???Z')`;
}

function dateCheck(column) {
  return `CHECK (${column} GLOB '????-??-??' AND date(${column}) = ${column})`;
}

function canonicalSql(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;=])\s*/g, '$1')
    .trim()
    .replace(/;$/, '')
    .toLowerCase();
}

function authorityTableSql() {
  return `
    CREATE TABLE ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} (
      recordId TEXT PRIMARY KEY,
      authorityId TEXT NOT NULL,
      authorityVersion INTEGER NOT NULL,
      previousRecordId TEXT NULL,
      authorityKind TEXT NOT NULL,
      status TEXT NOT NULL,
      environment TEXT NOT NULL,
      actorId TEXT NOT NULL,
      companyId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sourceSystemIdsJson TEXT NOT NULL,
      sourceRowClassesJson TEXT NOT NULL,
      allowedOperation TEXT NOT NULL,
      artifactDigest TEXT NOT NULL,
      sourceCommitSha TEXT NOT NULL,
      configurationHash TEXT NOT NULL,
      policyHash TEXT NOT NULL,
      sourceOwnershipManifestHash TEXT NOT NULL,
      credentialType TEXT NOT NULL,
      credentialFingerprint TEXT NULL,
      credentialIssuerRef TEXT NULL,
      effectiveFrom TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      ownerRef TEXT NOT NULL,
      approvalRef TEXT NOT NULL,
      approvalHash TEXT NOT NULL,
      revocationReasonCode TEXT NULL,
      recordHash TEXT NOT NULL,
      schemaVersion INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      ${commonScopeForeignKeys()},
      FOREIGN KEY (previousRecordId, companyId, branchId, authorityKind, authorityId)
        REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
          (recordId, companyId, branchId, authorityKind, authorityId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      ${commonScopeChecks()},
      CHECK (length(trim(recordId)) > 0 AND length(trim(authorityId)) > 0),
      CHECK (typeof(authorityVersion) = 'integer' AND authorityVersion BETWEEN 1 AND 9007199254740991),
      CHECK ((authorityVersion = 1 AND previousRecordId IS NULL) OR (authorityVersion > 1 AND length(trim(previousRecordId)) > 0)),
      CHECK (authorityKind IN ('source_adapter', 'eligibility_producer', 'canonical_posting_adapter')),
      CHECK (status IN ('authorized', 'revoked', 'expired', 'superseded')),
      CHECK (environment = 'production'),
      CHECK (length(trim(actorId)) > 0),
      CHECK (json_valid(sourceSystemIdsJson) AND json_type(sourceSystemIdsJson) = 'array' AND json_array_length(sourceSystemIdsJson) > 0),
      CHECK (json_valid(sourceRowClassesJson) AND json_type(sourceRowClassesJson) = 'array' AND json_array_length(sourceRowClassesJson) > 0),
      CHECK (
        (authorityKind = 'source_adapter' AND allowedOperation = 'source_lineage.read.v1')
        OR (authorityKind = 'eligibility_producer' AND allowedOperation = 'actual_receivable_eligible.append.v1')
        OR (authorityKind = 'canonical_posting_adapter' AND allowedOperation = 'canonical_receivable.initial_post.v1')
      ),
      CHECK (length(trim(artifactDigest)) > 0 AND length(trim(sourceCommitSha)) > 0),
      ${hashCheck('configurationHash')},
      ${hashCheck('policyHash')},
      ${hashCheck('sourceOwnershipManifestHash')},
      CHECK (credentialType = 'none_same_process_repository_owned'),
      CHECK (credentialFingerprint IS NULL AND credentialIssuerRef IS NULL),
      ${timestampCheck('effectiveFrom')},
      ${timestampCheck('expiresAt')},
      CHECK (effectiveFrom < expiresAt),
      CHECK ((julianday(expiresAt) - julianday(effectiveFrom)) * 86400000 <= 86400000),
      CHECK (length(trim(ownerRef)) > 0 AND length(trim(approvalRef)) > 0),
      ${hashCheck('approvalHash')},
      CHECK ((status = 'authorized' AND revocationReasonCode IS NULL) OR (status != 'authorized' AND length(trim(revocationReasonCode)) > 0)),
      ${hashCheck('recordHash')},
      CHECK (schemaVersion = 1),
      ${timestampCheck('createdAt')}
    );
  `;
}

function writeAuthorizationTableSql() {
  return `
    CREATE TABLE ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE} (
      recordId TEXT PRIMARY KEY,
      authorizationId TEXT NOT NULL,
      authorizationVersion INTEGER NOT NULL,
      previousRecordId TEXT NULL,
      status TEXT NOT NULL,
      companyId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      activationBoundaryId TEXT NOT NULL,
      activationCohortRef TEXT NOT NULL,
      cohortHash TEXT NOT NULL,
      boundaryHash TEXT NOT NULL,
      sourceSystemIdsJson TEXT NOT NULL,
      sourceAdapterAuthorityRecordId TEXT NOT NULL,
      sourceAdapterAuthorityVersion INTEGER NOT NULL,
      sourceAdapterAuthorityRecordHash TEXT NOT NULL,
      sourceOwnershipManifestHash TEXT NOT NULL,
      producerAuthorityRecordId TEXT NOT NULL,
      producerAuthorityVersion INTEGER NOT NULL,
      producerAuthorityRecordHash TEXT NOT NULL,
      producerAuthorityCompanyId TEXT NOT NULL,
      producerAuthorityBranchId TEXT NOT NULL,
      producerAuthorityKind TEXT NOT NULL,
      postingAdapterAuthorityRecordId TEXT NOT NULL,
      postingAdapterAuthorityVersion INTEGER NOT NULL,
      postingAdapterAuthorityRecordHash TEXT NOT NULL,
      postingAdapterAuthorityCompanyId TEXT NOT NULL,
      postingAdapterAuthorityBranchId TEXT NOT NULL,
      postingAdapterAuthorityKind TEXT NOT NULL,
      eventSchemaVersion TEXT NOT NULL,
      operationType TEXT NOT NULL,
      primaryEffectTablesJson TEXT NOT NULL,
      denialEvidenceTable TEXT NOT NULL,
      denialEvidencePermission TEXT NOT NULL,
      denialTransitionTable TEXT NOT NULL,
      denialTransitionPermission TEXT NOT NULL,
      forbiddenOperationsJson TEXT NOT NULL,
      policyManifestHashesJson TEXT NOT NULL,
      evidencePackHash TEXT NOT NULL,
      acceptedDryRunsJson TEXT NOT NULL,
      acceptedDryRunsHash TEXT NOT NULL,
      acceptedPr8EvidenceJson TEXT NOT NULL,
      acceptedPr8EvidenceHash TEXT NOT NULL,
      acceptedCompanyTimezoneSnapshot TEXT NOT NULL,
      acceptedFreshnessWindowsHash TEXT NOT NULL,
      amountBasisPolicyRef TEXT NOT NULL,
      amountBasisPolicyHash TEXT NOT NULL,
      dueDatePolicySetJson TEXT NOT NULL,
      dueDatePolicySetHash TEXT NOT NULL,
      operationalControlRef TEXT NOT NULL,
      retentionControlRef TEXT NOT NULL,
      backupEvidenceRef TEXT NOT NULL,
      approvalSetJson TEXT NOT NULL,
      effectiveFrom TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      revocationReasonCode TEXT NULL,
      recordHash TEXT NOT NULL,
      schemaVersion INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      ${commonScopeForeignKeys()},
      FOREIGN KEY (previousRecordId)
        REFERENCES ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE}(recordId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (activationBoundaryId, companyId, branchId)
        REFERENCES ${BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE}(id, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        sourceAdapterAuthorityRecordId, sourceAdapterAuthorityVersion,
        sourceAdapterAuthorityRecordHash, companyId, branchId
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (recordId, authorityVersion, recordHash, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        producerAuthorityCompanyId, producerAuthorityBranchId, producerAuthorityKind,
        producerAuthorityRecordId, producerAuthorityVersion, producerAuthorityRecordHash
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (companyId, branchId, authorityKind, recordId, authorityVersion, recordHash)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        postingAdapterAuthorityCompanyId, postingAdapterAuthorityBranchId,
        postingAdapterAuthorityKind, postingAdapterAuthorityRecordId,
        postingAdapterAuthorityVersion, postingAdapterAuthorityRecordHash
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (companyId, branchId, authorityKind, recordId, authorityVersion, recordHash)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      ${commonScopeChecks()},
      CHECK (length(trim(recordId)) > 0 AND length(trim(authorizationId)) > 0),
      CHECK (typeof(authorizationVersion) = 'integer' AND authorizationVersion BETWEEN 1 AND 9007199254740991),
      CHECK ((authorizationVersion = 1 AND previousRecordId IS NULL) OR (authorizationVersion > 1 AND length(trim(previousRecordId)) > 0)),
      CHECK (status IN ('authorized', 'revoked', 'expired', 'superseded')),
      CHECK (length(trim(activationBoundaryId)) > 0 AND length(trim(activationCohortRef)) > 0),
      ${hashCheck('cohortHash')},
      ${hashCheck('boundaryHash')},
      CHECK (sourceSystemIdsJson = '["rentcore.billing_source_authority.v1"]'),
      CHECK (typeof(sourceAdapterAuthorityVersion) = 'integer' AND sourceAdapterAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('sourceAdapterAuthorityRecordHash')},
      ${hashCheck('sourceOwnershipManifestHash')},
      CHECK (typeof(producerAuthorityVersion) = 'integer' AND producerAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('producerAuthorityRecordHash')},
      CHECK (producerAuthorityCompanyId = companyId AND producerAuthorityBranchId = branchId),
      CHECK (producerAuthorityKind = 'eligibility_producer'),
      CHECK (typeof(postingAdapterAuthorityVersion) = 'integer' AND postingAdapterAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('postingAdapterAuthorityRecordHash')},
      CHECK (postingAdapterAuthorityCompanyId = companyId AND postingAdapterAuthorityBranchId = branchId),
      CHECK (postingAdapterAuthorityKind = 'canonical_posting_adapter'),
      CHECK (eventSchemaVersion = 'ActualReceivableEligibleV1'),
      CHECK (operationType = 'canonical_receivable.initial_post.v1'),
      CHECK (primaryEffectTablesJson = '["canonical_receivable_posting_operations","canonical_receivables","financial_audit_events"]'),
      CHECK (denialEvidenceTable = 'canonical_receivable_posting_conflicts'),
      CHECK (denialEvidencePermission = 'canonical_receivable_posting_conflicts.append_after_denial.v1'),
      CHECK (denialTransitionTable = 'canonical_receivable_posting_conflict_transitions'),
      CHECK (denialTransitionPermission = 'canonical_receivable_posting_conflict_transitions.create_and_advance.v1'),
      CHECK (forbiddenOperationsJson = '["adjust","allocate","backfill","cancel","correct","delete","dual_write","refund","settle","update","write_off"]'),
      CHECK (json_valid(policyManifestHashesJson) AND json_type(policyManifestHashesJson) = 'array' AND json_array_length(policyManifestHashesJson) > 0),
      ${hashCheck('evidencePackHash')},
      CHECK (json_valid(acceptedDryRunsJson) AND json_type(acceptedDryRunsJson) = 'array' AND json_array_length(acceptedDryRunsJson) > 0),
      ${hashCheck('acceptedDryRunsHash')},
      CHECK (json_valid(acceptedPr8EvidenceJson) AND json_type(acceptedPr8EvidenceJson) = 'array' AND json_array_length(acceptedPr8EvidenceJson) > 0),
      ${hashCheck('acceptedPr8EvidenceHash')},
      CHECK (length(trim(acceptedCompanyTimezoneSnapshot)) > 0),
      ${hashCheck('acceptedFreshnessWindowsHash')},
      CHECK (length(trim(amountBasisPolicyRef)) > 0),
      ${hashCheck('amountBasisPolicyHash')},
      CHECK (json_valid(dueDatePolicySetJson) AND json_type(dueDatePolicySetJson) = 'object'),
      ${hashCheck('dueDatePolicySetHash')},
      CHECK (length(trim(operationalControlRef)) > 0),
      CHECK (length(trim(retentionControlRef)) > 0),
      CHECK (length(trim(backupEvidenceRef)) > 0),
      CHECK (json_valid(approvalSetJson) AND json_type(approvalSetJson) = 'object'),
      ${timestampCheck('effectiveFrom')},
      ${timestampCheck('expiresAt')},
      CHECK (effectiveFrom < expiresAt),
      CHECK ((julianday(expiresAt) - julianday(effectiveFrom)) * 86400000 <= 86400000),
      CHECK ((status = 'authorized' AND revocationReasonCode IS NULL) OR (status != 'authorized' AND length(trim(revocationReasonCode)) > 0)),
      ${hashCheck('recordHash')},
      CHECK (schemaVersion = 1),
      ${timestampCheck('createdAt')}
    );
  `;
}

function activationTableSql() {
  return `
    CREATE TABLE ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE} (
      recordId TEXT PRIMARY KEY,
      activationId TEXT NOT NULL,
      activationVersion INTEGER NOT NULL,
      previousRecordId TEXT NULL,
      status TEXT NOT NULL,
      companyId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      activationBoundaryId TEXT NOT NULL,
      forwardOnlyStartDate TEXT NOT NULL,
      forwardOnlyStartUtc TEXT NOT NULL,
      boundaryEndUtc TEXT NULL,
      companyTimezoneSnapshot TEXT NOT NULL,
      sourceSystemIdsJson TEXT NOT NULL,
      allowedDocumentClassesJson TEXT NOT NULL,
      allowedRentalClassesJson TEXT NOT NULL,
      currency TEXT NOT NULL,
      explicitExclusionsJson TEXT NOT NULL,
      cohortHash TEXT NOT NULL,
      boundaryHash TEXT NOT NULL,
      policyManifestHashesJson TEXT NOT NULL,
      acceptedDryRunsHash TEXT NOT NULL,
      acceptedPr8EvidenceHash TEXT NOT NULL,
      acceptedFreshnessWindowsHash TEXT NOT NULL,
      dueDatePolicySetJson TEXT NOT NULL,
      dueDatePolicySetHash TEXT NOT NULL,
      postingAdapterAuthorityRecordId TEXT NOT NULL,
      postingAdapterAuthorityVersion INTEGER NOT NULL,
      postingAdapterAuthorityRecordHash TEXT NOT NULL,
      postingAdapterAuthorityCompanyId TEXT NOT NULL,
      postingAdapterAuthorityBranchId TEXT NOT NULL,
      postingAdapterAuthorityKind TEXT NOT NULL,
      writeAuthorizationRecordId TEXT NOT NULL,
      effectiveFrom TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      approvalRef TEXT NOT NULL,
      approvalHash TEXT NOT NULL,
      revocationReasonCode TEXT NULL,
      recordHash TEXT NOT NULL,
      schemaVersion INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      ${commonScopeForeignKeys()},
      FOREIGN KEY (previousRecordId)
        REFERENCES ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE}(recordId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (activationBoundaryId, companyId, branchId)
        REFERENCES ${BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE}(id, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (writeAuthorizationRecordId)
        REFERENCES ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE}(recordId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        postingAdapterAuthorityCompanyId, postingAdapterAuthorityBranchId,
        postingAdapterAuthorityKind, postingAdapterAuthorityRecordId,
        postingAdapterAuthorityVersion, postingAdapterAuthorityRecordHash
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (companyId, branchId, authorityKind, recordId, authorityVersion, recordHash)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      ${commonScopeChecks()},
      CHECK (length(trim(recordId)) > 0 AND length(trim(activationId)) > 0),
      CHECK (typeof(activationVersion) = 'integer' AND activationVersion BETWEEN 1 AND 9007199254740991),
      CHECK ((activationVersion = 1 AND previousRecordId IS NULL) OR (activationVersion > 1 AND length(trim(previousRecordId)) > 0)),
      CHECK (status IN ('authorized', 'revoked', 'expired', 'superseded')),
      CHECK (length(trim(activationBoundaryId)) > 0),
      ${dateCheck('forwardOnlyStartDate')},
      ${timestampCheck('forwardOnlyStartUtc')},
      CHECK (boundaryEndUtc IS NULL),
      CHECK (length(trim(companyTimezoneSnapshot)) > 0),
      CHECK (sourceSystemIdsJson = '["rentcore.billing_source_authority.v1"]'),
      CHECK (allowedDocumentClassesJson = '["rental_service_upd"]'),
      CHECK (allowedRentalClassesJson = '["equipment_rental_line"]'),
      CHECK (currency = 'RUB'),
      CHECK (json_valid(explicitExclusionsJson) AND json_type(explicitExclusionsJson) = 'array'),
      ${hashCheck('cohortHash')},
      ${hashCheck('boundaryHash')},
      CHECK (json_valid(policyManifestHashesJson) AND json_type(policyManifestHashesJson) = 'array' AND json_array_length(policyManifestHashesJson) > 0),
      ${hashCheck('acceptedDryRunsHash')},
      ${hashCheck('acceptedPr8EvidenceHash')},
      ${hashCheck('acceptedFreshnessWindowsHash')},
      CHECK (json_valid(dueDatePolicySetJson) AND json_type(dueDatePolicySetJson) = 'object'),
      ${hashCheck('dueDatePolicySetHash')},
      CHECK (typeof(postingAdapterAuthorityVersion) = 'integer' AND postingAdapterAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('postingAdapterAuthorityRecordHash')},
      CHECK (postingAdapterAuthorityCompanyId = companyId AND postingAdapterAuthorityBranchId = branchId),
      CHECK (postingAdapterAuthorityKind = 'canonical_posting_adapter'),
      CHECK (length(trim(writeAuthorizationRecordId)) > 0),
      ${timestampCheck('effectiveFrom')},
      ${timestampCheck('expiresAt')},
      CHECK (effectiveFrom < expiresAt),
      CHECK ((julianday(expiresAt) - julianday(effectiveFrom)) * 86400000 <= 86400000),
      CHECK (length(trim(approvalRef)) > 0),
      ${hashCheck('approvalHash')},
      CHECK ((status = 'authorized' AND revocationReasonCode IS NULL) OR (status != 'authorized' AND length(trim(revocationReasonCode)) > 0)),
      ${hashCheck('recordHash')},
      CHECK (schemaVersion = 1),
      ${timestampCheck('createdAt')}
    );
  `;
}

function eligibleEventTableSql() {
  const pr6ForeignKeys = [
    ['activationBoundaryId', BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE],
    ['rentalLineId', BILLING_SOURCE_RENTAL_LINES_TABLE],
    ['periodId', BILLING_SOURCE_PERIODS_TABLE],
    ['closedPeriodVersionId', BILLING_SOURCE_PERIOD_VERSIONS_TABLE],
    ['snapshotId', BILLING_SOURCE_SNAPSHOTS_TABLE],
    ['updId', BILLING_SOURCE_UPDS_TABLE],
    ['formedUpdVersionId', BILLING_SOURCE_UPD_VERSIONS_TABLE],
    ['conductedUpdVersionId', BILLING_SOURCE_UPD_VERSIONS_TABLE],
    ['updLineId', BILLING_SOURCE_UPD_LINES_TABLE],
    ['updLineVersionId', BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE],
    ['coverageSetId', BILLING_SOURCE_COVERAGE_SETS_TABLE],
    ['coverageSliceId', BILLING_SOURCE_COVERAGE_SLICES_TABLE],
  ].map(([column, table]) => `
      FOREIGN KEY (${column}, companyId, branchId)
        REFERENCES ${table}(id, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT`).join(',');

  return `
    CREATE TABLE ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE} (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      economicLineageKey TEXT NOT NULL,
      economicSourceRevisionKey TEXT NOT NULL,
      rootSourceDocumentLineageId TEXT NOT NULL,
      rootCoverageLineageId TEXT NOT NULL,
      currentPr6RevisionHash TEXT NOT NULL,
      eventSchemaVersion TEXT NOT NULL,
      eventVersion INTEGER NOT NULL,
      dryRunId TEXT NOT NULL,
      candidateId TEXT NOT NULL,
      candidateResultHash TEXT NOT NULL,
      completeInputSetHash TEXT NOT NULL,
      policyManifestHash TEXT NOT NULL,
      sourceOwnershipManifestHash TEXT NOT NULL,
      acceptedDryRunsHash TEXT NOT NULL,
      acceptedPr8EvidenceHash TEXT NOT NULL,
      activationBoundaryId TEXT NOT NULL,
      activationRecordId TEXT NOT NULL,
      activationCohortRef TEXT NOT NULL,
      cohortHash TEXT NOT NULL,
      periodId TEXT NOT NULL,
      closedPeriodVersionId TEXT NOT NULL,
      snapshotId TEXT NOT NULL,
      updId TEXT NOT NULL,
      formedUpdVersionId TEXT NOT NULL,
      conductedUpdVersionId TEXT NOT NULL,
      updLineId TEXT NOT NULL,
      updLineVersionId TEXT NOT NULL,
      coverageSetId TEXT NOT NULL,
      coverageSliceId TEXT NOT NULL,
      clientId TEXT NOT NULL,
      contractId TEXT NULL,
      rentalId TEXT NOT NULL,
      rentalLineId TEXT NOT NULL,
      sliceStartDate TEXT NOT NULL,
      sliceEndDateExclusive TEXT NOT NULL,
      currency TEXT NOT NULL,
      companyTimezoneSnapshot TEXT NOT NULL,
      netAmountMinor INTEGER NOT NULL,
      vatAmountMinor INTEGER NOT NULL,
      grossAmountMinor INTEGER NOT NULL,
      originalAmountMinor INTEGER NOT NULL,
      amountBasis TEXT NOT NULL,
      amountBasisPolicyRef TEXT NOT NULL,
      amountBasisPolicyHash TEXT NOT NULL,
      contractualDueDate TEXT NULL,
      dueDateProvenance TEXT NOT NULL,
      dueDateEvidenceRef TEXT NULL,
      dueDatePolicySetHash TEXT NOT NULL,
      selectedDueDateGateKind TEXT NOT NULL,
      selectedDueDatePolicyId TEXT NOT NULL,
      selectedDueDatePolicyVersion INTEGER NOT NULL,
      selectedDueDatePolicyHash TEXT NOT NULL,
      dueDateTreatment TEXT NOT NULL,
      unknownDueDateTreatmentMappingId TEXT NULL,
      unknownDueDateTreatmentMappingVersion INTEGER NULL,
      unknownDueDateTreatmentMappingHash TEXT NULL,
      sourceAdapterAuthorityRecordId TEXT NOT NULL,
      sourceAdapterAuthorityVersion INTEGER NOT NULL,
      sourceAdapterAuthorityRecordHash TEXT NOT NULL,
      producerAuthorityRecordId TEXT NOT NULL,
      producerAuthorityVersion INTEGER NOT NULL,
      producerAuthorityRecordHash TEXT NOT NULL,
      producerAuthorityCompanyId TEXT NOT NULL,
      producerAuthorityBranchId TEXT NOT NULL,
      producerAuthorityKind TEXT NOT NULL,
      writeAuthorizationRecordId TEXT NOT NULL,
      sourceLineageHash TEXT NOT NULL,
      correlationId TEXT NOT NULL,
      eventHash TEXT NOT NULL,
      schemaVersion INTEGER NOT NULL,
      occurredAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      ${commonScopeForeignKeys()},
      FOREIGN KEY (dryRunId, companyId, branchId)
        REFERENCES ${ACTUAL_SOURCE_DRY_RUNS_TABLE}(id, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (candidateId, dryRunId, companyId, branchId)
        REFERENCES ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE}(id, runId, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      ${pr6ForeignKeys},
      FOREIGN KEY (activationRecordId)
        REFERENCES ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE}(recordId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        sourceAdapterAuthorityRecordId, sourceAdapterAuthorityVersion,
        sourceAdapterAuthorityRecordHash, companyId, branchId
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (recordId, authorityVersion, recordHash, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        producerAuthorityCompanyId, producerAuthorityBranchId, producerAuthorityKind,
        producerAuthorityRecordId, producerAuthorityVersion, producerAuthorityRecordHash
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (companyId, branchId, authorityKind, recordId, authorityVersion, recordHash)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (writeAuthorizationRecordId)
        REFERENCES ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE}(recordId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      ${commonScopeChecks()},
      CHECK (length(trim(id)) > 0),
      ${hashCheck('economicLineageKey')},
      ${hashCheck('economicSourceRevisionKey')},
      CHECK (length(trim(rootSourceDocumentLineageId)) > 0 AND length(trim(rootCoverageLineageId)) > 0),
      ${hashCheck('currentPr6RevisionHash')},
      CHECK (eventSchemaVersion = 'ActualReceivableEligibleV1' AND eventVersion = 1),
      CHECK (length(trim(dryRunId)) > 0 AND length(trim(candidateId)) > 0),
      ${hashCheck('candidateResultHash')},
      ${hashCheck('completeInputSetHash')},
      ${hashCheck('policyManifestHash')},
      ${hashCheck('sourceOwnershipManifestHash')},
      ${hashCheck('acceptedDryRunsHash')},
      ${hashCheck('acceptedPr8EvidenceHash')},
      CHECK (length(trim(activationRecordId)) > 0 AND length(trim(activationCohortRef)) > 0),
      ${hashCheck('cohortHash')},
      CHECK (length(trim(clientId)) > 0 AND (contractId IS NULL OR length(trim(contractId)) > 0)),
      CHECK (length(trim(rentalId)) > 0 AND length(trim(rentalLineId)) > 0),
      ${dateCheck('sliceStartDate')},
      ${dateCheck('sliceEndDateExclusive')},
      CHECK (sliceStartDate < sliceEndDateExclusive),
      CHECK (currency = 'RUB'),
      CHECK (length(trim(companyTimezoneSnapshot)) > 0),
      CHECK (typeof(netAmountMinor) = 'integer' AND netAmountMinor BETWEEN 0 AND 9007199254740991),
      CHECK (typeof(vatAmountMinor) = 'integer' AND vatAmountMinor BETWEEN 0 AND 9007199254740991),
      CHECK (typeof(grossAmountMinor) = 'integer' AND grossAmountMinor BETWEEN 1 AND 9007199254740991),
      CHECK (typeof(originalAmountMinor) = 'integer' AND originalAmountMinor BETWEEN 1 AND 9007199254740991),
      CHECK (netAmountMinor + vatAmountMinor = grossAmountMinor),
      CHECK (originalAmountMinor = grossAmountMinor),
      CHECK (amountBasis = 'gross' AND length(trim(amountBasisPolicyRef)) > 0),
      ${hashCheck('amountBasisPolicyHash')},
      CHECK (dueDateProvenance IN ('invoice_due_date', 'contractual_payment_due_date', 'installment_due_date', 'unknown')),
      CHECK (
        (dueDateProvenance = 'unknown' AND contractualDueDate IS NULL AND dueDateEvidenceRef IS NULL)
        OR (
          dueDateProvenance != 'unknown'
          AND contractualDueDate GLOB '????-??-??'
          AND date(contractualDueDate) = contractualDueDate
          AND length(trim(dueDateEvidenceRef)) > 0
        )
      ),
      ${hashCheck('dueDatePolicySetHash')},
      CHECK (selectedDueDateGateKind IN ('contractual_due_date', 'unknown_due_date_treatment')),
      CHECK (length(trim(selectedDueDatePolicyId)) > 0),
      CHECK (typeof(selectedDueDatePolicyVersion) = 'integer' AND selectedDueDatePolicyVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('selectedDueDatePolicyHash')},
      CHECK (
        (
          dueDateProvenance != 'unknown'
          AND selectedDueDateGateKind = 'contractual_due_date'
          AND dueDateTreatment = 'proven_contractual_date_v1'
          AND unknownDueDateTreatmentMappingId IS NULL
          AND unknownDueDateTreatmentMappingVersion IS NULL
          AND unknownDueDateTreatmentMappingHash IS NULL
        ) OR (
          dueDateProvenance = 'unknown'
          AND selectedDueDateGateKind = 'unknown_due_date_treatment'
          AND dueDateTreatment = 'post_without_aging_v1'
          AND unknownDueDateTreatmentMappingId = 'rentcore.unknown_due_date_posting_treatment.v1'
          AND unknownDueDateTreatmentMappingVersion = 1
          AND length(unknownDueDateTreatmentMappingHash) = 64
          AND unknownDueDateTreatmentMappingHash NOT GLOB '*[^0-9a-f]*'
        )
      ),
      CHECK (typeof(sourceAdapterAuthorityVersion) = 'integer' AND sourceAdapterAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('sourceAdapterAuthorityRecordHash')},
      CHECK (typeof(producerAuthorityVersion) = 'integer' AND producerAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('producerAuthorityRecordHash')},
      CHECK (producerAuthorityCompanyId = companyId AND producerAuthorityBranchId = branchId),
      CHECK (producerAuthorityKind = 'eligibility_producer'),
      CHECK (length(trim(writeAuthorizationRecordId)) > 0),
      ${hashCheck('sourceLineageHash')},
      CHECK (length(trim(correlationId)) > 0),
      ${hashCheck('eventHash')},
      CHECK (schemaVersion = 1),
      ${timestampCheck('occurredAt')},
      ${timestampCheck('createdAt')},
      CHECK (occurredAt = createdAt)
    );
  `;
}

function postingOperationTableSql() {
  return `
    CREATE TABLE ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      operationType TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL,
      eventId TEXT NOT NULL,
      eventHash TEXT NOT NULL,
      economicLineageKey TEXT NOT NULL,
      economicSourceRevisionKey TEXT NOT NULL,
      currentPr6RevisionHash TEXT NOT NULL,
      sourceAdapterAuthorityRecordId TEXT NOT NULL,
      sourceAdapterAuthorityVersion INTEGER NOT NULL,
      sourceAdapterAuthorityRecordHash TEXT NOT NULL,
      sourceOwnershipManifestHash TEXT NOT NULL,
      postingAdapterAuthorityRecordId TEXT NOT NULL,
      postingAdapterAuthorityVersion INTEGER NOT NULL,
      postingAdapterAuthorityRecordHash TEXT NOT NULL,
      postingAdapterAuthorityCompanyId TEXT NOT NULL,
      postingAdapterAuthorityBranchId TEXT NOT NULL,
      postingAdapterAuthorityKind TEXT NOT NULL,
      writeAuthorizationRecordId TEXT NOT NULL,
      activationRecordId TEXT NOT NULL,
      acceptedDryRunsHash TEXT NOT NULL,
      acceptedPr8EvidenceHash TEXT NOT NULL,
      dueDatePolicySetHash TEXT NOT NULL,
      selectedDueDateGateKind TEXT NOT NULL,
      selectedDueDatePolicyId TEXT NOT NULL,
      selectedDueDatePolicyVersion INTEGER NOT NULL,
      selectedDueDatePolicyHash TEXT NOT NULL,
      dueDateTreatment TEXT NOT NULL,
      unknownDueDateTreatmentMappingId TEXT NULL,
      unknownDueDateTreatmentMappingVersion INTEGER NULL,
      unknownDueDateTreatmentMappingHash TEXT NULL,
      canonicalReceivableId TEXT NOT NULL,
      canonicalReceivableFingerprint TEXT NOT NULL,
      sourceLineageHash TEXT NOT NULL,
      commandFingerprint TEXT NOT NULL,
      auditPayloadFingerprint TEXT NOT NULL,
      auditEventFingerprint TEXT NOT NULL,
      resultHash TEXT NOT NULL,
      financialAuditEventId TEXT NOT NULL,
      correlationId TEXT NOT NULL,
      schemaVersion INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      ${commonScopeForeignKeys()},
      FOREIGN KEY (eventId)
        REFERENCES ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        sourceAdapterAuthorityRecordId, sourceAdapterAuthorityVersion,
        sourceAdapterAuthorityRecordHash, companyId, branchId
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (recordId, authorityVersion, recordHash, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        postingAdapterAuthorityCompanyId, postingAdapterAuthorityBranchId,
        postingAdapterAuthorityKind, postingAdapterAuthorityRecordId,
        postingAdapterAuthorityVersion, postingAdapterAuthorityRecordHash
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (companyId, branchId, authorityKind, recordId, authorityVersion, recordHash)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (writeAuthorizationRecordId)
        REFERENCES ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE}(recordId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (activationRecordId)
        REFERENCES ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE}(recordId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (companyId, canonicalReceivableId, branchId)
        REFERENCES ${CANONICAL_RECEIVABLES_TABLE}(companyId, id, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (financialAuditEventId, companyId, branchId)
        REFERENCES ${FINANCIAL_AUDIT_EVENTS_TABLE}(id, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      ${commonScopeChecks()},
      CHECK (length(trim(id)) > 0),
      CHECK (operationType = 'canonical_receivable.initial_post.v1'),
      CHECK (length(trim(idempotencyKey)) > 0 AND length(trim(eventId)) > 0),
      ${hashCheck('eventHash')},
      ${hashCheck('economicLineageKey')},
      ${hashCheck('economicSourceRevisionKey')},
      ${hashCheck('currentPr6RevisionHash')},
      CHECK (typeof(sourceAdapterAuthorityVersion) = 'integer' AND sourceAdapterAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('sourceAdapterAuthorityRecordHash')},
      ${hashCheck('sourceOwnershipManifestHash')},
      CHECK (typeof(postingAdapterAuthorityVersion) = 'integer' AND postingAdapterAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('postingAdapterAuthorityRecordHash')},
      CHECK (postingAdapterAuthorityCompanyId = companyId AND postingAdapterAuthorityBranchId = branchId),
      CHECK (postingAdapterAuthorityKind = 'canonical_posting_adapter'),
      CHECK (length(trim(writeAuthorizationRecordId)) > 0 AND length(trim(activationRecordId)) > 0),
      ${hashCheck('acceptedDryRunsHash')},
      ${hashCheck('acceptedPr8EvidenceHash')},
      ${hashCheck('dueDatePolicySetHash')},
      CHECK (selectedDueDateGateKind IN ('contractual_due_date', 'unknown_due_date_treatment')),
      CHECK (length(trim(selectedDueDatePolicyId)) > 0),
      CHECK (typeof(selectedDueDatePolicyVersion) = 'integer' AND selectedDueDatePolicyVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('selectedDueDatePolicyHash')},
      CHECK (
        (
          selectedDueDateGateKind = 'contractual_due_date'
          AND dueDateTreatment = 'proven_contractual_date_v1'
          AND unknownDueDateTreatmentMappingId IS NULL
          AND unknownDueDateTreatmentMappingVersion IS NULL
          AND unknownDueDateTreatmentMappingHash IS NULL
        ) OR (
          selectedDueDateGateKind = 'unknown_due_date_treatment'
          AND dueDateTreatment = 'post_without_aging_v1'
          AND unknownDueDateTreatmentMappingId = 'rentcore.unknown_due_date_posting_treatment.v1'
          AND unknownDueDateTreatmentMappingVersion = 1
          AND length(unknownDueDateTreatmentMappingHash) = 64
          AND unknownDueDateTreatmentMappingHash NOT GLOB '*[^0-9a-f]*'
        )
      ),
      CHECK (length(trim(canonicalReceivableId)) > 0),
      ${hashCheck('canonicalReceivableFingerprint')},
      ${hashCheck('sourceLineageHash')},
      ${hashCheck('commandFingerprint')},
      ${hashCheck('auditPayloadFingerprint')},
      ${hashCheck('auditEventFingerprint')},
      ${hashCheck('resultHash')},
      CHECK (length(trim(financialAuditEventId)) > 0 AND length(trim(correlationId)) > 0),
      CHECK (schemaVersion = 1),
      ${timestampCheck('createdAt')}
    );
  `;
}

function conflictTableSql() {
  const conflictTypesSql = CANONICAL_POSTING_CONFLICT_TYPES
    .map(type => `'${type}'`)
    .join(', ');
  return `
    CREATE TABLE ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE} (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      conflictType TEXT NOT NULL,
      severity TEXT NOT NULL,
      eventId TEXT NULL,
      eventHash TEXT NULL,
      economicLineageKey TEXT NULL,
      economicSourceRevisionKey TEXT NULL,
      economicLineageCandidateFingerprint TEXT NOT NULL,
      existingReceivableId TEXT NULL,
      existingOperationId TEXT NULL,
      conflictObservationJson TEXT NOT NULL,
      conflictObservationHash TEXT NOT NULL,
      expectedFingerprint TEXT NOT NULL,
      observedFingerprint TEXT NOT NULL,
      sourceAdapterAuthorityRecordId TEXT NOT NULL,
      sourceAdapterAuthorityVersion INTEGER NOT NULL,
      sourceAdapterAuthorityRecordHash TEXT NOT NULL,
      sourceOwnershipManifestHash TEXT NOT NULL,
      producerAuthorityRecordId TEXT NOT NULL,
      producerAuthorityVersion INTEGER NOT NULL,
      producerAuthorityRecordHash TEXT NOT NULL,
      producerAuthorityCompanyId TEXT NOT NULL,
      producerAuthorityBranchId TEXT NOT NULL,
      producerAuthorityKind TEXT NOT NULL,
      postingAdapterAuthorityRecordId TEXT NOT NULL,
      postingAdapterAuthorityVersion INTEGER NOT NULL,
      postingAdapterAuthorityRecordHash TEXT NOT NULL,
      postingAdapterAuthorityCompanyId TEXT NOT NULL,
      postingAdapterAuthorityBranchId TEXT NOT NULL,
      postingAdapterAuthorityKind TEXT NOT NULL,
      writeAuthorizationRecordId TEXT NOT NULL,
      activationRecordId TEXT NOT NULL,
      acceptedDryRunsHash TEXT NOT NULL,
      acceptedPr8EvidenceHash TEXT NOT NULL,
      sourceLineageHash TEXT NOT NULL,
      deniedAuthorityKind TEXT NULL,
      deniedAuthorityRecordId TEXT NULL,
      deniedAuthorityVersion INTEGER NULL,
      deniedAuthorityRecordHash TEXT NULL,
      denialAttemptId TEXT NOT NULL,
      deniedAttemptedAt TEXT NOT NULL,
      evidenceAttemptedAt TEXT NOT NULL,
      sourceAuthorityChainSnapshotJson TEXT NOT NULL,
      sourceAuthorityChainSnapshotHash TEXT NOT NULL,
      producerAuthorityChainSnapshotJson TEXT NOT NULL,
      producerAuthorityChainSnapshotHash TEXT NOT NULL,
      postingAuthorityChainSnapshotJson TEXT NOT NULL,
      postingAuthorityChainSnapshotHash TEXT NOT NULL,
      correlationId TEXT NOT NULL,
      detectorVersion TEXT NOT NULL,
      conflictHash TEXT NOT NULL,
      transitionId TEXT NOT NULL,
      schemaVersion INTEGER NOT NULL,
      detectedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      ${commonScopeForeignKeys()},
      FOREIGN KEY (eventId)
        REFERENCES ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (existingOperationId)
        REFERENCES ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (companyId, existingReceivableId, branchId)
        REFERENCES ${CANONICAL_RECEIVABLES_TABLE}(companyId, id, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        sourceAdapterAuthorityRecordId, sourceAdapterAuthorityVersion,
        sourceAdapterAuthorityRecordHash, companyId, branchId
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (recordId, authorityVersion, recordHash, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        producerAuthorityCompanyId, producerAuthorityBranchId, producerAuthorityKind,
        producerAuthorityRecordId, producerAuthorityVersion, producerAuthorityRecordHash
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (companyId, branchId, authorityKind, recordId, authorityVersion, recordHash)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        postingAdapterAuthorityCompanyId, postingAdapterAuthorityBranchId,
        postingAdapterAuthorityKind, postingAdapterAuthorityRecordId,
        postingAdapterAuthorityVersion, postingAdapterAuthorityRecordHash
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (companyId, branchId, authorityKind, recordId, authorityVersion, recordHash)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (writeAuthorizationRecordId)
        REFERENCES ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE}(recordId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (activationRecordId)
        REFERENCES ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE}(recordId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (
        deniedAuthorityRecordId, deniedAuthorityVersion, deniedAuthorityRecordHash,
        companyId, branchId
      ) REFERENCES ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        (recordId, authorityVersion, recordHash, companyId, branchId)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (transitionId, id, companyId, branchId, denialAttemptId, conflictHash)
        REFERENCES ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
          (transitionId, conflictId, companyId, branchId, denialAttemptId, conflictHash)
        ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      ${commonScopeChecks()},
      CHECK (length(trim(id)) > 0),
      CHECK (conflictType IN (${conflictTypesSql})),
      CHECK (severity = 'p0'),
      ${nullableHashCheck('eventHash')},
      ${nullableHashCheck('economicLineageKey')},
      ${nullableHashCheck('economicSourceRevisionKey')},
      ${hashCheck('economicLineageCandidateFingerprint')},
      CHECK (json_valid(conflictObservationJson) AND json_type(conflictObservationJson) = 'object'),
      ${hashCheck('conflictObservationHash')},
      ${hashCheck('expectedFingerprint')},
      ${hashCheck('observedFingerprint')},
      CHECK (expectedFingerprint != observedFingerprint),
      CHECK (typeof(sourceAdapterAuthorityVersion) = 'integer' AND sourceAdapterAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('sourceAdapterAuthorityRecordHash')},
      ${hashCheck('sourceOwnershipManifestHash')},
      CHECK (typeof(producerAuthorityVersion) = 'integer' AND producerAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('producerAuthorityRecordHash')},
      CHECK (producerAuthorityCompanyId = companyId AND producerAuthorityBranchId = branchId),
      CHECK (producerAuthorityKind = 'eligibility_producer'),
      CHECK (typeof(postingAdapterAuthorityVersion) = 'integer' AND postingAdapterAuthorityVersion BETWEEN 1 AND 9007199254740991),
      ${hashCheck('postingAdapterAuthorityRecordHash')},
      CHECK (postingAdapterAuthorityCompanyId = companyId AND postingAdapterAuthorityBranchId = branchId),
      CHECK (postingAdapterAuthorityKind = 'canonical_posting_adapter'),
      CHECK (length(trim(writeAuthorizationRecordId)) > 0 AND length(trim(activationRecordId)) > 0),
      ${hashCheck('acceptedDryRunsHash')},
      ${hashCheck('acceptedPr8EvidenceHash')},
      ${hashCheck('sourceLineageHash')},
      CHECK (
        (
          conflictType GLOB 'SOURCE_ADAPTER_*'
          OR conflictType GLOB 'ELIGIBILITY_PRODUCER_*'
          OR conflictType GLOB 'CANONICAL_POSTING_ADAPTER_*'
        )
        = (deniedAuthorityKind IS NOT NULL)
      ),
      CHECK (
        (deniedAuthorityKind IS NULL AND deniedAuthorityRecordId IS NULL AND deniedAuthorityVersion IS NULL AND deniedAuthorityRecordHash IS NULL)
        OR (
          deniedAuthorityKind IN ('source_adapter', 'eligibility_producer', 'canonical_posting_adapter')
          AND length(trim(deniedAuthorityRecordId)) > 0
          AND typeof(deniedAuthorityVersion) = 'integer'
          AND deniedAuthorityVersion BETWEEN 1 AND 9007199254740991
          AND length(deniedAuthorityRecordHash) = 64
          AND deniedAuthorityRecordHash NOT GLOB '*[^0-9a-f]*'
        )
      ),
      CHECK (length(denialAttemptId) = 36 AND denialAttemptId = lower(denialAttemptId)),
      CHECK (substr(denialAttemptId, 9, 1) = '-' AND substr(denialAttemptId, 14, 1) = '-'),
      CHECK (substr(denialAttemptId, 15, 1) = '4' AND substr(denialAttemptId, 19, 1) = '-'),
      CHECK (substr(denialAttemptId, 20, 1) IN ('8', '9', 'a', 'b') AND substr(denialAttemptId, 24, 1) = '-'),
      CHECK (replace(denialAttemptId, '-', '') NOT GLOB '*[^0-9a-f]*'),
      ${timestampCheck('deniedAttemptedAt')},
      ${timestampCheck('evidenceAttemptedAt')},
      CHECK (json_valid(sourceAuthorityChainSnapshotJson) AND json_type(sourceAuthorityChainSnapshotJson) = 'object'),
      ${hashCheck('sourceAuthorityChainSnapshotHash')},
      CHECK (json_valid(producerAuthorityChainSnapshotJson) AND json_type(producerAuthorityChainSnapshotJson) = 'object'),
      ${hashCheck('producerAuthorityChainSnapshotHash')},
      CHECK (json_valid(postingAuthorityChainSnapshotJson) AND json_type(postingAuthorityChainSnapshotJson) = 'object'),
      ${hashCheck('postingAuthorityChainSnapshotHash')},
      CHECK (length(trim(correlationId)) > 0),
      CHECK (detectorVersion = 'canonical-posting-conflict-detector-v1'),
      ${hashCheck('conflictHash')},
      ${hashCheck('transitionId')},
      CHECK (schemaVersion = 1),
      ${timestampCheck('detectedAt')},
      ${timestampCheck('createdAt')},
      CHECK (detectedAt = deniedAttemptedAt AND createdAt = evidenceAttemptedAt)
    );
  `;
}

function conflictTransitionTableSql() {
  return `
    CREATE TABLE ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE} (
      transitionId TEXT PRIMARY KEY,
      conflictId TEXT NOT NULL,
      companyId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      operationDomain TEXT NOT NULL,
      scopeSequence INTEGER NOT NULL,
      transitionKind TEXT NOT NULL,
      denialAttemptId TEXT NOT NULL,
      conflictHash TEXT NOT NULL,
      conflictType TEXT NOT NULL,
      circuitRule TEXT NOT NULL,
      attemptAccountingKey TEXT NOT NULL,
      rateAccountingKey TEXT NOT NULL,
      circuitTransitionKey TEXT NOT NULL,
      state TEXT NOT NULL,
      attemptApplied INTEGER NOT NULL,
      attemptResultJson TEXT NULL,
      attemptResultHash TEXT NULL,
      rateApplied INTEGER NOT NULL,
      rateResultJson TEXT NULL,
      rateResultHash TEXT NULL,
      circuitApplied INTEGER NOT NULL,
      circuitResultJson TEXT NULL,
      circuitResultHash TEXT NULL,
      intentHash TEXT NOT NULL,
      schemaVersion INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      ${commonScopeForeignKeys()},
      FOREIGN KEY (conflictId, companyId, branchId, denialAttemptId, conflictHash)
        REFERENCES ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE}
          (id, companyId, branchId, denialAttemptId, conflictHash)
        ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      ${commonScopeChecks()},
      ${hashCheck('transitionId')},
      CHECK (length(trim(conflictId)) > 0),
      CHECK (operationDomain = 'canonical_receivable.initial_post.v1'),
      CHECK (typeof(scopeSequence) = 'integer' AND scopeSequence BETWEEN 1 AND 9007199254740991),
      CHECK (transitionKind = 'required_conflict_accounting_circuit_v1'),
      CHECK (length(denialAttemptId) = 36 AND denialAttemptId = lower(denialAttemptId)),
      CHECK (substr(denialAttemptId, 15, 1) = '4' AND substr(denialAttemptId, 20, 1) IN ('8', '9', 'a', 'b')),
      CHECK (replace(denialAttemptId, '-', '') NOT GLOB '*[^0-9a-f]*'),
      ${hashCheck('conflictHash')},
      CHECK (conflictType IN (${CANONICAL_POSTING_CONFLICT_TYPES.map(type => `'${type}'`).join(', ')})),
      CHECK (
        (conflictType IN ('AUTHORIZATION_DRIFT', 'ACTIVATION_DRIFT') AND circuitRule = 'fifth_in_five')
        OR (conflictType NOT IN ('AUTHORIZATION_DRIFT', 'ACTIVATION_DRIFT') AND circuitRule = 'immediate')
      ),
      ${hashCheck('attemptAccountingKey')},
      ${hashCheck('rateAccountingKey')},
      ${hashCheck('circuitTransitionKey')},
      CHECK (attemptAccountingKey != rateAccountingKey),
      CHECK (attemptAccountingKey != circuitTransitionKey),
      CHECK (rateAccountingKey != circuitTransitionKey),
      CHECK (state IN ('PENDING', 'ACCOUNTED', 'CIRCUIT_APPLIED', 'COMPLETE')),
      CHECK (attemptApplied IN (0, 1) AND rateApplied IN (0, 1) AND circuitApplied IN (0, 1)),
      CHECK (
        (
          state = 'PENDING'
          AND rateApplied = 0
          AND circuitApplied = 0
          AND (
            (attemptApplied = 0 AND attemptResultJson IS NULL AND attemptResultHash IS NULL)
            OR (
              attemptApplied = 1
              AND json_valid(attemptResultJson)
              AND json_type(attemptResultJson) = 'object'
              AND length(attemptResultHash) = 64
              AND attemptResultHash NOT GLOB '*[^0-9a-f]*'
            )
          )
          AND rateResultJson IS NULL AND rateResultHash IS NULL
          AND circuitResultJson IS NULL AND circuitResultHash IS NULL
        ) OR (
          state = 'ACCOUNTED'
          AND attemptApplied = 1 AND rateApplied = 1 AND circuitApplied = 0
          AND json_valid(attemptResultJson) AND json_type(attemptResultJson) = 'object'
          AND length(attemptResultHash) = 64 AND attemptResultHash NOT GLOB '*[^0-9a-f]*'
          AND json_valid(rateResultJson) AND json_type(rateResultJson) = 'object'
          AND length(rateResultHash) = 64 AND rateResultHash NOT GLOB '*[^0-9a-f]*'
          AND circuitResultJson IS NULL AND circuitResultHash IS NULL
        ) OR (
          state IN ('CIRCUIT_APPLIED', 'COMPLETE')
          AND attemptApplied = 1 AND rateApplied = 1 AND circuitApplied = 1
          AND json_valid(attemptResultJson) AND json_type(attemptResultJson) = 'object'
          AND length(attemptResultHash) = 64 AND attemptResultHash NOT GLOB '*[^0-9a-f]*'
          AND json_valid(rateResultJson) AND json_type(rateResultJson) = 'object'
          AND length(rateResultHash) = 64 AND rateResultHash NOT GLOB '*[^0-9a-f]*'
          AND json_valid(circuitResultJson) AND json_type(circuitResultJson) = 'object'
          AND length(circuitResultHash) = 64 AND circuitResultHash NOT GLOB '*[^0-9a-f]*'
        )
      ),
      ${hashCheck('intentHash')},
      CHECK (schemaVersion = 1),
      ${timestampCheck('createdAt')}
    );
  `;
}

function immutableUpdateTriggerSql(table) {
  return `
    CREATE TRIGGER trg_${table}_no_update
    BEFORE UPDATE ON ${table}
    BEGIN
      SELECT RAISE(ABORT, '${table} is immutable');
    END;
  `;
}

function immutableDeleteTriggerSql(table) {
  return `
    CREATE TRIGGER trg_${table}_no_delete
    BEFORE DELETE ON ${table}
    BEGIN
      SELECT RAISE(ABORT, '${table} is append-only');
    END;
  `;
}

const IMMUTABLE_PR9_TABLES = Object.freeze([
  GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE,
  CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
  CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
  ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
]);

function noReplacePredicate(table) {
  const predicates = {
    [GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE]: `
      existing.recordId = NEW.recordId
      OR existing.recordHash = NEW.recordHash
      OR (
        existing.companyId = NEW.companyId
        AND existing.branchId = NEW.branchId
        AND existing.authorityKind = NEW.authorityKind
        AND existing.authorityId = NEW.authorityId
        AND existing.authorityVersion = NEW.authorityVersion
      )`,
    [CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE]: `
      existing.recordId = NEW.recordId
      OR existing.recordHash = NEW.recordHash
      OR (existing.authorizationId = NEW.authorizationId AND existing.authorizationVersion = NEW.authorizationVersion)`,
    [CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE]: `
      existing.recordId = NEW.recordId
      OR existing.recordHash = NEW.recordHash
      OR (existing.activationId = NEW.activationId AND existing.activationVersion = NEW.activationVersion)`,
    [ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE]: `
      existing.id = NEW.id
      OR (existing.companyId = NEW.companyId AND existing.branchId = NEW.branchId AND existing.economicLineageKey = NEW.economicLineageKey)
      OR (existing.companyId = NEW.companyId AND existing.branchId = NEW.branchId AND existing.economicSourceRevisionKey = NEW.economicSourceRevisionKey)
      OR (existing.companyId = NEW.companyId AND existing.eventHash = NEW.eventHash)
      OR (existing.dryRunId = NEW.dryRunId AND existing.candidateId = NEW.candidateId)`,
    [CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE]: `
      existing.id = NEW.id
      OR (existing.companyId = NEW.companyId AND existing.operationType = NEW.operationType AND existing.idempotencyKey = NEW.idempotencyKey)
      OR existing.eventId = NEW.eventId
      OR (existing.companyId = NEW.companyId AND existing.branchId = NEW.branchId AND existing.economicLineageKey = NEW.economicLineageKey)
      OR existing.canonicalReceivableId = NEW.canonicalReceivableId
      OR existing.financialAuditEventId = NEW.financialAuditEventId`,
    [CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE]: `
      existing.id = NEW.id
      OR (existing.companyId = NEW.companyId AND existing.conflictHash = NEW.conflictHash)
      OR existing.denialAttemptId = NEW.denialAttemptId
      OR existing.transitionId = NEW.transitionId`,
  };
  return predicates[table];
}

function noReplaceTriggerSql(table) {
  return `
    CREATE TRIGGER trg_${table}_no_replace
    BEFORE INSERT ON ${table}
    WHEN EXISTS (
      SELECT 1 FROM ${table} AS existing WHERE ${noReplacePredicate(table)}
    )
    BEGIN
      SELECT RAISE(ABORT, '${table} is append-only');
    END;
  `;
}

function authorityVersionChainTriggerSql() {
  return `
    CREATE TRIGGER trg_pr9_adapter_authority_version_chain
    BEFORE INSERT ON ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
    WHEN (
      NEW.authorityVersion = 1
      AND EXISTS (
        SELECT 1 FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS existing
        WHERE existing.companyId = NEW.companyId
          AND existing.branchId = NEW.branchId
          AND existing.authorityKind = NEW.authorityKind
          AND existing.authorityId = NEW.authorityId
      )
    ) OR (
      NEW.authorityVersion > 1
      AND NOT EXISTS (
        SELECT 1 FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS predecessor
        WHERE predecessor.recordId = NEW.previousRecordId
          AND predecessor.companyId = NEW.companyId
          AND predecessor.branchId = NEW.branchId
          AND predecessor.authorityKind = NEW.authorityKind
          AND predecessor.authorityId = NEW.authorityId
          AND predecessor.authorityVersion = NEW.authorityVersion - 1
          AND predecessor.authorityVersion = (
            SELECT MAX(latest.authorityVersion)
            FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS latest
            WHERE latest.companyId = NEW.companyId
              AND latest.branchId = NEW.branchId
              AND latest.authorityKind = NEW.authorityKind
              AND latest.authorityId = NEW.authorityId
          )
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_AUTHORITY_VERSION_CHAIN_INVALID');
    END;
  `;
}

function simpleVersionChainTriggerSql({ name, table, idColumn, versionColumn }) {
  return `
    CREATE TRIGGER ${name}
    BEFORE INSERT ON ${table}
    WHEN (
      NEW.${versionColumn} = 1
      AND EXISTS (SELECT 1 FROM ${table} AS existing WHERE existing.${idColumn} = NEW.${idColumn})
    ) OR (
      NEW.${versionColumn} > 1
      AND NOT EXISTS (
        SELECT 1 FROM ${table} AS predecessor
        WHERE predecessor.recordId = NEW.previousRecordId
          AND predecessor.${idColumn} = NEW.${idColumn}
          AND predecessor.companyId = NEW.companyId
          AND predecessor.branchId = NEW.branchId
          AND predecessor.${versionColumn} = NEW.${versionColumn} - 1
          AND predecessor.${versionColumn} = (
            SELECT MAX(latest.${versionColumn}) FROM ${table} AS latest
            WHERE latest.${idColumn} = NEW.${idColumn}
          )
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_AUTHORITY_VERSION_CHAIN_INVALID');
    END;
  `;
}

function bindingTriggerSql(name, table, failurePredicate) {
  return `
    CREATE TRIGGER ${name}
    BEFORE INSERT ON ${table}
    WHEN ${failurePredicate}
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_AUTHORITY_BINDING_INVALID');
    END;
  `;
}

function authorityBindingTriggers() {
  const sourceLatest = `
    NOT EXISTS (
      SELECT 1 FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS authority
      WHERE authority.recordId = NEW.sourceAdapterAuthorityRecordId
        AND authority.authorityVersion = NEW.sourceAdapterAuthorityVersion
        AND authority.recordHash = NEW.sourceAdapterAuthorityRecordHash
        AND authority.companyId = NEW.companyId
        AND authority.branchId = NEW.branchId
        AND authority.authorityKind = 'source_adapter'
        AND authority.allowedOperation = 'source_lineage.read.v1'
        AND authority.sourceOwnershipManifestHash = NEW.sourceOwnershipManifestHash
        AND authority.status = 'authorized'
        AND authority.authorityVersion = (
          SELECT MAX(latest.authorityVersion)
          FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS latest
          WHERE latest.companyId = authority.companyId
            AND latest.branchId = authority.branchId
            AND latest.authorityKind = authority.authorityKind
            AND latest.authorityId = authority.authorityId
        )
    )`;
  const sourceEvidence = `
    NOT EXISTS (
      SELECT 1 FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS authority
      WHERE authority.recordId = NEW.sourceAdapterAuthorityRecordId
        AND authority.authorityVersion = NEW.sourceAdapterAuthorityVersion
        AND authority.recordHash = NEW.sourceAdapterAuthorityRecordHash
        AND authority.companyId = NEW.companyId
        AND authority.branchId = NEW.branchId
        AND authority.authorityKind = 'source_adapter'
        AND authority.allowedOperation = 'source_lineage.read.v1'
        AND authority.sourceOwnershipManifestHash = NEW.sourceOwnershipManifestHash
    )`;
  const producerLatest = `
    NOT EXISTS (
      SELECT 1 FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS authority
      WHERE authority.recordId = NEW.producerAuthorityRecordId
        AND authority.authorityVersion = NEW.producerAuthorityVersion
        AND authority.recordHash = NEW.producerAuthorityRecordHash
        AND authority.companyId = NEW.producerAuthorityCompanyId
        AND authority.branchId = NEW.producerAuthorityBranchId
        AND authority.authorityKind = NEW.producerAuthorityKind
        AND authority.allowedOperation = 'actual_receivable_eligible.append.v1'
        AND authority.status = 'authorized'
        AND authority.authorityVersion = (
          SELECT MAX(latest.authorityVersion)
          FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS latest
          WHERE latest.companyId = authority.companyId
            AND latest.branchId = authority.branchId
            AND latest.authorityKind = authority.authorityKind
            AND latest.authorityId = authority.authorityId
        )
    )`;
  const producerEvidence = `
    NOT EXISTS (
      SELECT 1 FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS authority
      WHERE authority.recordId = NEW.producerAuthorityRecordId
        AND authority.authorityVersion = NEW.producerAuthorityVersion
        AND authority.recordHash = NEW.producerAuthorityRecordHash
        AND authority.companyId = NEW.producerAuthorityCompanyId
        AND authority.branchId = NEW.producerAuthorityBranchId
        AND authority.authorityKind = NEW.producerAuthorityKind
        AND authority.allowedOperation = 'actual_receivable_eligible.append.v1'
    )`;
  const postingLatest = `
    NOT EXISTS (
      SELECT 1 FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS authority
      WHERE authority.recordId = NEW.postingAdapterAuthorityRecordId
        AND authority.authorityVersion = NEW.postingAdapterAuthorityVersion
        AND authority.recordHash = NEW.postingAdapterAuthorityRecordHash
        AND authority.companyId = NEW.postingAdapterAuthorityCompanyId
        AND authority.branchId = NEW.postingAdapterAuthorityBranchId
        AND authority.authorityKind = NEW.postingAdapterAuthorityKind
        AND authority.allowedOperation = 'canonical_receivable.initial_post.v1'
        AND authority.status = 'authorized'
        AND authority.authorityVersion = (
          SELECT MAX(latest.authorityVersion)
          FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS latest
          WHERE latest.companyId = authority.companyId
            AND latest.branchId = authority.branchId
            AND latest.authorityKind = authority.authorityKind
            AND latest.authorityId = authority.authorityId
        )
    )`;
  const postingEvidence = `
    NOT EXISTS (
      SELECT 1 FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS authority
      WHERE authority.recordId = NEW.postingAdapterAuthorityRecordId
        AND authority.authorityVersion = NEW.postingAdapterAuthorityVersion
        AND authority.recordHash = NEW.postingAdapterAuthorityRecordHash
        AND authority.companyId = NEW.postingAdapterAuthorityCompanyId
        AND authority.branchId = NEW.postingAdapterAuthorityBranchId
        AND authority.authorityKind = NEW.postingAdapterAuthorityKind
        AND authority.allowedOperation = 'canonical_receivable.initial_post.v1'
    )`;

  return {
    trg_pr9_write_authorization_source_adapter_validate: bindingTriggerSql(
      'trg_pr9_write_authorization_source_adapter_validate',
      CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
      sourceLatest,
    ),
    trg_pr9_write_authorization_producer_validate: bindingTriggerSql(
      'trg_pr9_write_authorization_producer_validate',
      CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
      producerLatest,
    ),
    trg_pr9_write_authorization_posting_adapter_validate: bindingTriggerSql(
      'trg_pr9_write_authorization_posting_adapter_validate',
      CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
      postingLatest,
    ),
    trg_pr9_activation_posting_adapter_validate: bindingTriggerSql(
      'trg_pr9_activation_posting_adapter_validate',
      CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
      `${postingLatest} OR NOT EXISTS (
        SELECT 1 FROM ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE} AS authorization
        WHERE authorization.recordId = NEW.writeAuthorizationRecordId
          AND authorization.companyId = NEW.companyId
          AND authorization.branchId = NEW.branchId
          AND authorization.postingAdapterAuthorityRecordId = NEW.postingAdapterAuthorityRecordId
          AND authorization.postingAdapterAuthorityVersion = NEW.postingAdapterAuthorityVersion
          AND authorization.postingAdapterAuthorityRecordHash = NEW.postingAdapterAuthorityRecordHash
          AND authorization.status = 'authorized'
      )`,
    ),
    trg_pr9_event_source_adapter_validate: bindingTriggerSql(
      'trg_pr9_event_source_adapter_validate',
      ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
      `${sourceLatest} OR NOT EXISTS (
        SELECT 1 FROM ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE} AS authorization
        WHERE authorization.recordId = NEW.writeAuthorizationRecordId
          AND authorization.sourceAdapterAuthorityRecordId = NEW.sourceAdapterAuthorityRecordId
          AND authorization.sourceAdapterAuthorityVersion = NEW.sourceAdapterAuthorityVersion
          AND authorization.sourceAdapterAuthorityRecordHash = NEW.sourceAdapterAuthorityRecordHash
          AND authorization.sourceOwnershipManifestHash = NEW.sourceOwnershipManifestHash
      )`,
    ),
    trg_pr9_event_producer_validate: bindingTriggerSql(
      'trg_pr9_event_producer_validate',
      ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
      `${producerLatest} OR NOT EXISTS (
        SELECT 1 FROM ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE} AS authorization
        WHERE authorization.recordId = NEW.writeAuthorizationRecordId
          AND authorization.producerAuthorityRecordId = NEW.producerAuthorityRecordId
          AND authorization.producerAuthorityVersion = NEW.producerAuthorityVersion
          AND authorization.producerAuthorityRecordHash = NEW.producerAuthorityRecordHash
      )`,
    ),
    trg_pr9_operation_source_adapter_validate: bindingTriggerSql(
      'trg_pr9_operation_source_adapter_validate',
      CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
      sourceLatest,
    ),
    trg_pr9_operation_posting_adapter_validate: bindingTriggerSql(
      'trg_pr9_operation_posting_adapter_validate',
      CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
      postingLatest,
    ),
    trg_pr9_conflict_source_adapter_validate: bindingTriggerSql(
      'trg_pr9_conflict_source_adapter_validate',
      CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
      sourceEvidence,
    ),
    trg_pr9_conflict_producer_validate: bindingTriggerSql(
      'trg_pr9_conflict_producer_validate',
      CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
      producerEvidence,
    ),
    trg_pr9_conflict_posting_adapter_validate: bindingTriggerSql(
      'trg_pr9_conflict_posting_adapter_validate',
      CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
      postingEvidence,
    ),
    trg_pr9_conflict_denied_authority_validate: bindingTriggerSql(
      'trg_pr9_conflict_denied_authority_validate',
      CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
      `NEW.deniedAuthorityRecordId IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} AS authority
        WHERE authority.recordId = NEW.deniedAuthorityRecordId
          AND authority.authorityVersion = NEW.deniedAuthorityVersion
          AND authority.recordHash = NEW.deniedAuthorityRecordHash
          AND authority.companyId = NEW.companyId
          AND authority.branchId = NEW.branchId
          AND authority.authorityKind = NEW.deniedAuthorityKind
      )`,
    ),
  };
}

function transitionNoDeleteTriggerSql() {
  return `
    CREATE TRIGGER trg_canonical_receivable_posting_conflict_transitions_no_delete
    BEFORE DELETE ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_CONFLICT_TRANSITION_INTEGRITY_FAILED');
    END;
  `;
}

function transitionNoReplaceTriggerSql() {
  return `
    CREATE TRIGGER trg_canonical_receivable_posting_conflict_transitions_no_replace
    BEFORE INSERT ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
    WHEN EXISTS (
      SELECT 1 FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE} AS existing
      WHERE existing.transitionId = NEW.transitionId
         OR existing.conflictId = NEW.conflictId
         OR existing.denialAttemptId = NEW.denialAttemptId
         OR (existing.companyId = NEW.companyId AND existing.conflictHash = NEW.conflictHash)
         OR (
           existing.companyId = NEW.companyId
           AND existing.branchId = NEW.branchId
           AND existing.operationDomain = NEW.operationDomain
           AND existing.scopeSequence = NEW.scopeSequence
         )
         OR existing.attemptAccountingKey = NEW.attemptAccountingKey
         OR existing.rateAccountingKey = NEW.rateAccountingKey
         OR existing.circuitTransitionKey = NEW.circuitTransitionKey
    )
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_CONFLICT_TRANSITION_INTEGRITY_FAILED');
    END;
  `;
}

function transitionMonotonicTriggerSql() {
  return `
    CREATE TRIGGER trg_pr9_conflict_transition_monotonic_update
    BEFORE UPDATE ON ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
    WHEN
      OLD.transitionId IS NOT NEW.transitionId
      OR OLD.conflictId IS NOT NEW.conflictId
      OR OLD.companyId IS NOT NEW.companyId
      OR OLD.branchId IS NOT NEW.branchId
      OR OLD.operationDomain IS NOT NEW.operationDomain
      OR OLD.scopeSequence IS NOT NEW.scopeSequence
      OR OLD.transitionKind IS NOT NEW.transitionKind
      OR OLD.denialAttemptId IS NOT NEW.denialAttemptId
      OR OLD.conflictHash IS NOT NEW.conflictHash
      OR OLD.conflictType IS NOT NEW.conflictType
      OR OLD.circuitRule IS NOT NEW.circuitRule
      OR OLD.attemptAccountingKey IS NOT NEW.attemptAccountingKey
      OR OLD.rateAccountingKey IS NOT NEW.rateAccountingKey
      OR OLD.circuitTransitionKey IS NOT NEW.circuitTransitionKey
      OR OLD.intentHash IS NOT NEW.intentHash
      OR OLD.schemaVersion IS NOT NEW.schemaVersion
      OR OLD.createdAt IS NOT NEW.createdAt
      OR (
        NOT (
          OLD.state = 'PENDING' AND OLD.attemptApplied = 0
          AND NEW.state = 'PENDING' AND NEW.attemptApplied = 1
          AND NEW.rateApplied = 0 AND NEW.circuitApplied = 0
          AND OLD.attemptResultJson IS NULL AND OLD.attemptResultHash IS NULL
          AND NEW.attemptResultJson IS NOT NULL AND NEW.attemptResultHash IS NOT NULL
          AND OLD.rateResultJson IS NEW.rateResultJson AND OLD.rateResultHash IS NEW.rateResultHash
          AND OLD.circuitResultJson IS NEW.circuitResultJson AND OLD.circuitResultHash IS NEW.circuitResultHash
        )
        AND NOT (
          OLD.state = 'PENDING' AND OLD.attemptApplied = 1
          AND NEW.state = 'ACCOUNTED' AND NEW.attemptApplied = 1
          AND NEW.rateApplied = 1 AND NEW.circuitApplied = 0
          AND OLD.attemptResultJson IS NEW.attemptResultJson AND OLD.attemptResultHash IS NEW.attemptResultHash
          AND OLD.rateResultJson IS NULL AND OLD.rateResultHash IS NULL
          AND NEW.rateResultJson IS NOT NULL AND NEW.rateResultHash IS NOT NULL
          AND OLD.circuitResultJson IS NEW.circuitResultJson AND OLD.circuitResultHash IS NEW.circuitResultHash
        )
        AND NOT (
          OLD.state = 'ACCOUNTED'
          AND NEW.state = 'CIRCUIT_APPLIED'
          AND NEW.attemptApplied = 1 AND NEW.rateApplied = 1 AND NEW.circuitApplied = 1
          AND OLD.attemptResultJson IS NEW.attemptResultJson AND OLD.attemptResultHash IS NEW.attemptResultHash
          AND OLD.rateResultJson IS NEW.rateResultJson AND OLD.rateResultHash IS NEW.rateResultHash
          AND OLD.circuitResultJson IS NULL AND OLD.circuitResultHash IS NULL
          AND NEW.circuitResultJson IS NOT NULL AND NEW.circuitResultHash IS NOT NULL
        )
        AND NOT (
          OLD.state = 'CIRCUIT_APPLIED'
          AND NEW.state = 'COMPLETE'
          AND NEW.attemptApplied = 1 AND NEW.rateApplied = 1 AND NEW.circuitApplied = 1
          AND OLD.attemptResultJson IS NEW.attemptResultJson AND OLD.attemptResultHash IS NEW.attemptResultHash
          AND OLD.rateResultJson IS NEW.rateResultJson AND OLD.rateResultHash IS NEW.rateResultHash
          AND OLD.circuitResultJson IS NEW.circuitResultJson AND OLD.circuitResultHash IS NEW.circuitResultHash
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_CONFLICT_TRANSITION_INTEGRITY_FAILED');
    END;
  `;
}

function eventBeforeOperationSealTriggerSql() {
  return `
    CREATE TRIGGER trg_pr9_event_before_operation_seal
    BEFORE INSERT ON ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}
    WHEN NOT EXISTS (
      SELECT 1
      FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE} AS event
      JOIN ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE} AS authorization
        ON authorization.recordId = NEW.writeAuthorizationRecordId
      JOIN ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE} AS activation
        ON activation.recordId = NEW.activationRecordId
      WHERE event.id = NEW.eventId
        AND event.companyId = NEW.companyId
        AND event.branchId = NEW.branchId
        AND event.eventHash = NEW.eventHash
        AND event.economicLineageKey = NEW.economicLineageKey
        AND event.economicSourceRevisionKey = NEW.economicSourceRevisionKey
        AND event.currentPr6RevisionHash = NEW.currentPr6RevisionHash
        AND event.sourceAdapterAuthorityRecordId = NEW.sourceAdapterAuthorityRecordId
        AND event.sourceAdapterAuthorityVersion = NEW.sourceAdapterAuthorityVersion
        AND event.sourceAdapterAuthorityRecordHash = NEW.sourceAdapterAuthorityRecordHash
        AND event.sourceOwnershipManifestHash = NEW.sourceOwnershipManifestHash
        AND event.writeAuthorizationRecordId = NEW.writeAuthorizationRecordId
        AND event.activationRecordId = NEW.activationRecordId
        AND event.acceptedDryRunsHash = NEW.acceptedDryRunsHash
        AND event.acceptedPr8EvidenceHash = NEW.acceptedPr8EvidenceHash
        AND event.dueDatePolicySetHash = NEW.dueDatePolicySetHash
        AND event.selectedDueDateGateKind = NEW.selectedDueDateGateKind
        AND event.selectedDueDatePolicyId = NEW.selectedDueDatePolicyId
        AND event.selectedDueDatePolicyVersion = NEW.selectedDueDatePolicyVersion
        AND event.selectedDueDatePolicyHash = NEW.selectedDueDatePolicyHash
        AND event.dueDateTreatment = NEW.dueDateTreatment
        AND event.unknownDueDateTreatmentMappingId IS NEW.unknownDueDateTreatmentMappingId
        AND event.unknownDueDateTreatmentMappingVersion IS NEW.unknownDueDateTreatmentMappingVersion
        AND event.unknownDueDateTreatmentMappingHash IS NEW.unknownDueDateTreatmentMappingHash
        AND authorization.companyId = NEW.companyId
        AND authorization.branchId = NEW.branchId
        AND authorization.status = 'authorized'
        AND activation.companyId = NEW.companyId
        AND activation.branchId = NEW.branchId
        AND activation.status = 'authorized'
        AND activation.writeAuthorizationRecordId = authorization.recordId
        AND activation.postingAdapterAuthorityRecordId = NEW.postingAdapterAuthorityRecordId
        AND activation.postingAdapterAuthorityVersion = NEW.postingAdapterAuthorityVersion
        AND activation.postingAdapterAuthorityRecordHash = NEW.postingAdapterAuthorityRecordHash
    )
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_POSTING_OPERATION_SEAL_INTEGRITY_FAILED');
    END;
  `;
}

function operationFinalizeTriggerSql() {
  return `
    CREATE TRIGGER trg_pr9_operation_finalize
    BEFORE INSERT ON ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}
    WHEN NOT EXISTS (
      SELECT 1
      FROM ${CANONICAL_RECEIVABLES_TABLE} AS receivable
      JOIN ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE} AS event ON event.id = NEW.eventId
      WHERE receivable.id = NEW.canonicalReceivableId
        AND receivable.companyId = NEW.companyId
        AND receivable.branchId = NEW.branchId
        AND receivable.clientId = event.clientId
        AND receivable.contractId IS event.contractId
        AND receivable.rentalId = event.rentalId
        AND receivable.sourceDocumentType = 'rental_service_upd'
        AND receivable.sourceDocumentId = event.rootSourceDocumentLineageId
        AND receivable.sourceLineId = event.economicLineageKey
        AND receivable.sourceSystem = 'rentcore.billing_source_authority.v1'
        AND receivable.externalId = event.economicLineageKey
        AND receivable.idempotencyKey = NEW.idempotencyKey
        AND receivable.currency = 'RUB'
        AND receivable.originalAmountMinor = event.grossAmountMinor
        AND receivable.contractualDueDate IS event.contractualDueDate
        AND receivable.dueDateProvenance = event.dueDateProvenance
        AND receivable.companyTimezone = event.companyTimezoneSnapshot
        AND receivable.workflowStatus = 'posted'
        AND receivable.postedAt = NEW.createdAt
        AND receivable.createdAt = NEW.createdAt
        AND receivable.updatedAt = NEW.createdAt
    )
    BEGIN
      SELECT RAISE(ABORT, 'CANONICAL_POSTING_OPERATION_SEAL_INTEGRITY_FAILED');
    END;
  `;
}

function auditScopeTriggerSql() {
  return `
    CREATE TRIGGER trg_pr9_financial_audit_scope_validate_after_insert
    AFTER INSERT ON ${FINANCIAL_AUDIT_EVENTS_TABLE}
    WHEN NEW.eventType = 'canonical_receivable.initial_posted.v1'
      OR EXISTS (
        SELECT 1
        FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} AS operation
        WHERE operation.financialAuditEventId = NEW.id
      )
    BEGIN
      SELECT CASE WHEN (
        SELECT COUNT(*)
        FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} AS operation
        WHERE operation.financialAuditEventId = NEW.id
      ) != 1 THEN RAISE(ABORT, 'CANONICAL_AUDIT_SEAL_INTEGRITY_FAILED') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} AS operation
        JOIN ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE} AS event
          ON event.id = operation.eventId
        JOIN ${CANONICAL_RECEIVABLES_TABLE} AS receivable
          ON receivable.id = operation.canonicalReceivableId
        WHERE operation.financialAuditEventId = NEW.id
          AND operation.operationType = 'canonical_receivable.initial_post.v1'
          AND operation.schemaVersion = 1
          AND operation.companyId = NEW.companyId
          AND operation.branchId = NEW.branchId
          AND operation.correlationId = NEW.correlationId
          AND operation.createdAt = NEW.createdAt
          AND event.companyId = NEW.companyId
          AND event.branchId = NEW.branchId
          AND receivable.companyId = NEW.companyId
          AND receivable.branchId = NEW.branchId
          AND NEW.eventType = 'canonical_receivable.initial_posted.v1'
          AND NEW.aggregateType = 'canonical_receivable'
          AND NEW.aggregateId = operation.canonicalReceivableId
          AND NEW.actorId = 'integration:rentcore-canonical-receivable-posting'
          AND NEW.actorType = 'integration'
          AND NEW.occurredAt = operation.createdAt
          AND NEW.createdAt = NEW.occurredAt
          AND NEW.reason = 'canonical_actual_posting_initial_post_v1'
          AND NEW.previousValueJson IS NULL
          AND NEW.sourceSystem = 'rentcore.billing_source_authority.v1'
          AND json_valid(NEW.newValueJson)
          AND json_type(NEW.newValueJson) = 'object'
          AND (SELECT COUNT(*) FROM json_each(NEW.newValueJson)) = 33
          AND NOT EXISTS (
            SELECT 1 FROM json_each(NEW.newValueJson) AS payload
            WHERE payload.key NOT IN (
              'acceptedDryRunsHash', 'acceptedPr8EvidenceHash', 'activationRecordId',
              'actorAuthorityRecordId', 'actorIdentityId', 'auditPayloadFingerprint',
              'canonicalReceivableFingerprint', 'dueDatePolicySetHash', 'dueDateTreatment',
              'economicLineageKey', 'economicSourceRevisionKey', 'eventHash', 'eventId',
              'operationId', 'postingAdapterAuthorityBranchId',
              'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityKind',
              'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityRecordId',
              'postingAdapterAuthorityVersion', 'selectedDueDateGateKind',
              'selectedDueDatePolicyHash', 'selectedDueDatePolicyId',
              'selectedDueDatePolicyVersion', 'sourceAdapterAuthorityRecordHash',
              'sourceAdapterAuthorityRecordId', 'sourceAdapterAuthorityVersion',
              'sourceLineageHash', 'sourceOwnershipManifestHash',
              'unknownDueDateTreatmentMappingHash', 'unknownDueDateTreatmentMappingId',
              'unknownDueDateTreatmentMappingVersion', 'writeAuthorizationRecordId'
            )
          )
          AND json_extract(NEW.newValueJson, '$.acceptedDryRunsHash') = operation.acceptedDryRunsHash
          AND json_extract(NEW.newValueJson, '$.acceptedPr8EvidenceHash') = operation.acceptedPr8EvidenceHash
          AND json_extract(NEW.newValueJson, '$.activationRecordId') = operation.activationRecordId
          AND json_extract(NEW.newValueJson, '$.operationId') = operation.id
          AND json_extract(NEW.newValueJson, '$.eventId') = operation.eventId
          AND json_extract(NEW.newValueJson, '$.eventHash') = operation.eventHash
          AND json_extract(NEW.newValueJson, '$.economicLineageKey') = operation.economicLineageKey
          AND json_extract(NEW.newValueJson, '$.economicSourceRevisionKey') = operation.economicSourceRevisionKey
          AND json_extract(NEW.newValueJson, '$.canonicalReceivableFingerprint') = operation.canonicalReceivableFingerprint
          AND json_extract(NEW.newValueJson, '$.auditPayloadFingerprint') = operation.auditPayloadFingerprint
          AND json_extract(NEW.newValueJson, '$.dueDatePolicySetHash') = operation.dueDatePolicySetHash
          AND json_extract(NEW.newValueJson, '$.dueDateTreatment') = operation.dueDateTreatment
          AND json_extract(NEW.newValueJson, '$.actorIdentityId') = NEW.actorId
          AND json_extract(NEW.newValueJson, '$.actorAuthorityRecordId') = operation.postingAdapterAuthorityRecordId
          AND json_extract(NEW.newValueJson, '$.postingAdapterAuthorityBranchId') = operation.postingAdapterAuthorityBranchId
          AND json_extract(NEW.newValueJson, '$.postingAdapterAuthorityCompanyId') = operation.postingAdapterAuthorityCompanyId
          AND json_extract(NEW.newValueJson, '$.postingAdapterAuthorityKind') = operation.postingAdapterAuthorityKind
          AND json_extract(NEW.newValueJson, '$.postingAdapterAuthorityRecordId') = operation.postingAdapterAuthorityRecordId
          AND json_extract(NEW.newValueJson, '$.postingAdapterAuthorityRecordHash') = operation.postingAdapterAuthorityRecordHash
          AND json_extract(NEW.newValueJson, '$.postingAdapterAuthorityVersion') = operation.postingAdapterAuthorityVersion
          AND json_extract(NEW.newValueJson, '$.sourceAdapterAuthorityRecordId') = operation.sourceAdapterAuthorityRecordId
          AND json_extract(NEW.newValueJson, '$.sourceAdapterAuthorityRecordHash') = operation.sourceAdapterAuthorityRecordHash
          AND json_extract(NEW.newValueJson, '$.sourceAdapterAuthorityVersion') = operation.sourceAdapterAuthorityVersion
          AND json_extract(NEW.newValueJson, '$.sourceOwnershipManifestHash') = operation.sourceOwnershipManifestHash
          AND json_extract(NEW.newValueJson, '$.writeAuthorizationRecordId') = operation.writeAuthorizationRecordId
          AND json_extract(NEW.newValueJson, '$.selectedDueDateGateKind') = operation.selectedDueDateGateKind
          AND json_extract(NEW.newValueJson, '$.selectedDueDatePolicyHash') = operation.selectedDueDatePolicyHash
          AND json_extract(NEW.newValueJson, '$.selectedDueDatePolicyId') = operation.selectedDueDatePolicyId
          AND json_extract(NEW.newValueJson, '$.selectedDueDatePolicyVersion') = operation.selectedDueDatePolicyVersion
          AND json_extract(NEW.newValueJson, '$.sourceLineageHash') = operation.sourceLineageHash
          AND json_extract(NEW.newValueJson, '$.unknownDueDateTreatmentMappingId') IS operation.unknownDueDateTreatmentMappingId
          AND json_extract(NEW.newValueJson, '$.unknownDueDateTreatmentMappingVersion') IS operation.unknownDueDateTreatmentMappingVersion
          AND json_extract(NEW.newValueJson, '$.unknownDueDateTreatmentMappingHash') IS operation.unknownDueDateTreatmentMappingHash
      ) THEN RAISE(ABORT, 'CANONICAL_AUDIT_SEAL_INTEGRITY_FAILED') END;
    END;
  `;
}

function canonicalReceivableNoDeleteTriggerSql() {
  return `
    CREATE TRIGGER trg_pr9_canonical_receivable_no_delete
    BEFORE DELETE ON ${CANONICAL_RECEIVABLES_TABLE}
    WHEN OLD.sourceSystem = 'rentcore.billing_source_authority.v1'
    BEGIN
      SELECT RAISE(ABORT, 'canonical PR9 receivable is immutable');
    END;
  `;
}

function canonicalReceivableImmutabilityTriggerSql() {
  return `
    CREATE TRIGGER trg_pr9_canonical_receivable_full_immutability
    BEFORE UPDATE ON ${CANONICAL_RECEIVABLES_TABLE}
    WHEN OLD.sourceSystem = 'rentcore.billing_source_authority.v1'
    BEGIN
      SELECT RAISE(ABORT, 'canonical PR9 receivable is immutable');
    END;
  `;
}

function expectedTriggerDefinitions() {
  const definitions = {};
  for (const table of IMMUTABLE_PR9_TABLES) {
    definitions[`trg_${table}_no_update`] = immutableUpdateTriggerSql(table);
    definitions[`trg_${table}_no_delete`] = immutableDeleteTriggerSql(table);
    definitions[`trg_${table}_no_replace`] = noReplaceTriggerSql(table);
  }
  definitions.trg_canonical_receivable_posting_conflict_transitions_no_delete = transitionNoDeleteTriggerSql();
  definitions.trg_canonical_receivable_posting_conflict_transitions_no_replace = transitionNoReplaceTriggerSql();
  definitions.trg_pr9_conflict_transition_monotonic_update = transitionMonotonicTriggerSql();
  definitions.trg_pr9_adapter_authority_version_chain = authorityVersionChainTriggerSql();
  definitions.trg_pr9_write_authorization_version_chain = simpleVersionChainTriggerSql({
    name: 'trg_pr9_write_authorization_version_chain',
    table: CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
    idColumn: 'authorizationId',
    versionColumn: 'authorizationVersion',
  });
  definitions.trg_pr9_activation_version_chain = simpleVersionChainTriggerSql({
    name: 'trg_pr9_activation_version_chain',
    table: CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
    idColumn: 'activationId',
    versionColumn: 'activationVersion',
  });
  Object.assign(definitions, authorityBindingTriggers());
  definitions.trg_pr9_event_before_operation_seal = eventBeforeOperationSealTriggerSql();
  definitions.trg_pr9_operation_finalize = operationFinalizeTriggerSql();
  definitions.trg_pr9_financial_audit_scope_validate_after_insert = auditScopeTriggerSql();
  definitions.trg_pr9_canonical_receivable_no_delete = canonicalReceivableNoDeleteTriggerSql();
  definitions.trg_pr9_canonical_receivable_full_immutability = canonicalReceivableImmutabilityTriggerSql();
  return definitions;
}

function expectedTriggerTables() {
  const tables = {};
  for (const table of IMMUTABLE_PR9_TABLES) {
    tables[`trg_${table}_no_update`] = table;
    tables[`trg_${table}_no_delete`] = table;
    tables[`trg_${table}_no_replace`] = table;
  }
  tables.trg_canonical_receivable_posting_conflict_transitions_no_delete = CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE;
  tables.trg_canonical_receivable_posting_conflict_transitions_no_replace = CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE;
  tables.trg_pr9_conflict_transition_monotonic_update = CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE;
  tables.trg_pr9_adapter_authority_version_chain = GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE;
  tables.trg_pr9_write_authorization_version_chain = CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE;
  tables.trg_pr9_activation_version_chain = CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE;
  tables.trg_pr9_write_authorization_source_adapter_validate = CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE;
  tables.trg_pr9_write_authorization_producer_validate = CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE;
  tables.trg_pr9_write_authorization_posting_adapter_validate = CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE;
  tables.trg_pr9_activation_posting_adapter_validate = CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE;
  tables.trg_pr9_event_source_adapter_validate = ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE;
  tables.trg_pr9_event_producer_validate = ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE;
  tables.trg_pr9_operation_source_adapter_validate = CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE;
  tables.trg_pr9_operation_posting_adapter_validate = CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE;
  tables.trg_pr9_conflict_source_adapter_validate = CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE;
  tables.trg_pr9_conflict_producer_validate = CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE;
  tables.trg_pr9_conflict_posting_adapter_validate = CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE;
  tables.trg_pr9_conflict_denied_authority_validate = CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE;
  tables.trg_pr9_event_before_operation_seal = CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE;
  tables.trg_pr9_operation_finalize = CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE;
  tables.trg_pr9_financial_audit_scope_validate_after_insert = FINANCIAL_AUDIT_EVENTS_TABLE;
  tables.trg_pr9_canonical_receivable_no_delete = CANONICAL_RECEIVABLES_TABLE;
  tables.trg_pr9_canonical_receivable_full_immutability = CANONICAL_RECEIVABLES_TABLE;
  return tables;
}

const REQUIRED_TRIGGERS = Object.freeze(Object.keys(expectedTriggerDefinitions()));

const TABLE_DEFINITIONS = Object.freeze({
  [GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE]: authorityTableSql,
  [CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE]: writeAuthorizationTableSql,
  [CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE]: activationTableSql,
  [ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE]: eligibleEventTableSql,
  [CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE]: postingOperationTableSql,
  [CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE]: conflictTableSql,
  [CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE]: conflictTransitionTableSql,
});

const INTEGER_COLUMNS = new Set([
  'authorityVersion', 'authorizationVersion', 'activationVersion', 'eventVersion',
  'netAmountMinor', 'vatAmountMinor', 'grossAmountMinor', 'originalAmountMinor',
  'selectedDueDatePolicyVersion', 'unknownDueDateTreatmentMappingVersion',
  'sourceAdapterAuthorityVersion', 'producerAuthorityVersion',
  'postingAdapterAuthorityVersion', 'deniedAuthorityVersion', 'schemaVersion',
  'scopeSequence', 'attemptApplied', 'rateApplied', 'circuitApplied',
]);

const NULLABLE_COLUMNS = Object.freeze({
  [GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE]: new Set([
    'previousRecordId', 'credentialFingerprint', 'credentialIssuerRef', 'revocationReasonCode',
  ]),
  [CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE]: new Set(['previousRecordId', 'revocationReasonCode']),
  [CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE]: new Set([
    'previousRecordId', 'boundaryEndUtc', 'revocationReasonCode',
  ]),
  [ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE]: new Set([
    'contractId', 'contractualDueDate', 'dueDateEvidenceRef',
    'unknownDueDateTreatmentMappingId', 'unknownDueDateTreatmentMappingVersion',
    'unknownDueDateTreatmentMappingHash',
  ]),
  [CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE]: new Set([
    'unknownDueDateTreatmentMappingId', 'unknownDueDateTreatmentMappingVersion',
    'unknownDueDateTreatmentMappingHash',
  ]),
  [CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE]: new Set([
    'eventId', 'eventHash', 'economicLineageKey', 'economicSourceRevisionKey',
    'existingReceivableId', 'existingOperationId', 'deniedAuthorityKind',
    'deniedAuthorityRecordId', 'deniedAuthorityVersion', 'deniedAuthorityRecordHash',
  ]),
  [CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE]: new Set([
    'attemptResultJson', 'attemptResultHash', 'rateResultJson', 'rateResultHash',
    'circuitResultJson', 'circuitResultHash',
  ]),
});

function assertExactTableStructure(db) {
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const expectedSql = TABLE_DEFINITIONS[table]();
    const row = sqliteMasterObject(db, 'table', table);
    if (!row || canonicalSql(row.sql) !== canonicalSql(expectedSql)) {
      throw new Error(`CANONICAL_PR9_TABLE_STRUCTURE_MISMATCH:${table}`);
    }
    const actual = db.prepare(`PRAGMA table_info(${table})`).all();
    if (JSON.stringify(actual.map(column => column.name)) !== JSON.stringify(columns)) {
      throw new Error(`CANONICAL_PR9_TABLE_STRUCTURE_MISMATCH:${table}:columns`);
    }
    for (const column of actual) {
      const expectedType = INTEGER_COLUMNS.has(column.name) ? 'INTEGER' : 'TEXT';
      const expectedPrimaryKey = (
        (column.name === 'recordId' && [
          GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE,
          CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
          CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
        ].includes(table))
        || (column.name === 'id' && [
          ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
          CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
          CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
        ].includes(table))
        || (column.name === 'transitionId' && table === CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE)
      ) ? 1 : 0;
      const expectedNotNull = expectedPrimaryKey === 1
        ? 0
        : (NULLABLE_COLUMNS[table].has(column.name) ? 0 : 1);
      if (
        column.type !== expectedType
        || Number(column.pk) !== expectedPrimaryKey
        || Number(column.notnull) !== expectedNotNull
        || column.dflt_value !== null
      ) {
        throw new Error(`CANONICAL_PR9_TABLE_STRUCTURE_MISMATCH:${table}:${column.name}`);
      }
    }
  }
}

function indexMetadata(db, name) {
  for (const table of [...CANONICAL_ACTUAL_POSTING_TABLES, FINANCIAL_AUDIT_EVENTS_TABLE]) {
    const index = db.prepare(`PRAGMA index_list(${table})`).all().find(row => row.name === name);
    if (!index) continue;
    return {
      table,
      unique: Number(index.unique),
      partial: Number(index.partial),
      columns: db.prepare(`PRAGMA index_info(${name})`).all().map(row => row.name),
    };
  }
  return null;
}

function expectedIndexMetadata(name, sql) {
  const match = sql.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+\S+\s+ON\s+(\S+)\s*\(([^)]+)\)/i);
  if (!match) throw new Error(`CANONICAL_PR9_INTERNAL_INDEX_DEFINITION_INVALID:${name}`);
  return {
    table: match[2],
    unique: match[1] ? 1 : 0,
    partial: 0,
    columns: match[3].split(',').map(value => value.trim()),
  };
}

function assertExactIndexes(db) {
  for (const [name, expectedSql] of Object.entries(EXPECTED_INDEX_DEFINITIONS)) {
    const row = sqliteMasterObject(db, 'index', name);
    const actualMetadata = indexMetadata(db, name);
    const expectedMetadata = expectedIndexMetadata(name, expectedSql);
    if (
      !row
      || canonicalSql(row.sql) !== canonicalSql(expectedSql)
      || JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)
    ) {
      throw new Error(`CANONICAL_PR9_INDEX_STRUCTURE_MISMATCH:${name}`);
    }
  }
}

function assertExactTriggers(db) {
  const definitions = expectedTriggerDefinitions();
  const tables = expectedTriggerTables();
  for (const [name, expectedSql] of Object.entries(definitions)) {
    const row = sqliteMasterObject(db, 'trigger', name);
    if (
      !row
      || !sameBoundedSqliteIdentifier(row.tbl_name, tables[name])
      || canonicalSql(row.sql) !== canonicalSql(expectedSql)
    ) {
      throw new Error(`CANONICAL_PR9_TRIGGER_STRUCTURE_MISMATCH:${name}`);
    }
  }
}

function assertCanonicalActualPostingStructure(db, { requireMigration = true } = {}) {
  assertForeignKeysEnabled(db);
  assertNoCompetingRoots(db);
  assertPlatformIdentityStructure(db);
  assertBillingSourceAuthorityStructure(db);
  assertForecastReceivablesPlanningStructure(db);
  assertActualSourceEligibilityDryRunStructure(db);
  assertCapabilityCatalogExact(db);
  assertExactTableStructure(db);
  assertExactIndexes(db);
  assertExactTriggers(db);
  if (requireMigration) {
    const row = migrationRow(db, CANONICAL_ACTUAL_POSTING_MIGRATION_ID);
    if (Number(row?.version) !== CANONICAL_ACTUAL_POSTING_SCHEMA_VERSION) {
      throw new Error('CANONICAL_PR9_MIGRATION_REGISTRY_MISMATCH');
    }
  }
  assertForeignKeyCheckClean(db);
  return true;
}

function ensureCanonicalActualPostingSchema(db) {
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
  assertMigration(
    db,
    FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID,
    FORECAST_RECEIVABLES_PLANNING_SCHEMA_VERSION,
  );
  assertMigration(
    db,
    ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID,
    ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_SCHEMA_VERSION,
  );
  assertNoCompetingRoots(db);
  assertPlatformIdentityStructure(db);
  assertBillingSourceAuthorityStructure(db);
  assertForecastReceivablesPlanningStructure(db);
  assertActualSourceEligibilityDryRunStructure(db);
  assertCapabilityCatalogExact(db);
  assertForeignKeyCheckClean(db);

  const applied = migrationRow(db, CANONICAL_ACTUAL_POSTING_MIGRATION_ID);
  if (applied) {
    if (Number(applied.version) !== CANONICAL_ACTUAL_POSTING_SCHEMA_VERSION) {
      throw new Error(`CANONICAL_PR9_MIGRATION_VERSION_MISMATCH:${applied.version}`);
    }
    assertCanonicalActualPostingStructure(db);
    return false;
  }
  if (hasUnexpectedPartialState(db)) throw new Error('CANONICAL_PR9_UNEXPECTED_PARTIAL_STATE');
  assertFirstApplicationTablesEmpty(db);

  const migrate = db.transaction(() => {
    for (const definition of Object.values(TABLE_DEFINITIONS)) db.exec(definition());
    for (const definition of Object.values(EXPECTED_INDEX_DEFINITIONS)) db.exec(definition);
    for (const definition of Object.values(expectedTriggerDefinitions())) db.exec(definition);
    assertCanonicalActualPostingStructure(db, { requireMigration: false });
    db.prepare(`
      INSERT INTO sql_shadow_schema_migrations (name, version)
      VALUES (?, ?)
    `).run(CANONICAL_ACTUAL_POSTING_MIGRATION_ID, CANONICAL_ACTUAL_POSTING_SCHEMA_VERSION);
    return true;
  });

  return migrate.immediate();
}

module.exports = {
  ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
  CANONICAL_ACTUAL_POSTING_MIGRATION_ID,
  CANONICAL_ACTUAL_POSTING_SCHEMA_VERSION,
  CANONICAL_ACTUAL_POSTING_TABLES,
  CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
  CANONICAL_POSTING_CONFLICT_TYPES,
  CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
  CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
  GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE,
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
  REQUIRED_TRIGGERS,
  ZERO_ROW_PREREQUISITES,
  assertCanonicalActualPostingStructure,
  ensureCanonicalActualPostingSchema,
};
