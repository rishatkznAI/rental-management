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
  CAPABILITY_CATALOG_ENTRIES_TABLE,
  COMPANY_MEMBERSHIPS_TABLE,
  FINANCIAL_TABLES,
  PLATFORM_IDENTITY_MIGRATION_ID,
  PLATFORM_IDENTITY_SCHEMA_VERSION,
  assertPlatformIdentityStructure,
} = require('./platform-identity-schema');
const {
  BILLING_SOURCE_AUTHORITY_MIGRATION_ID,
  BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
  BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE,
  BILLING_SOURCE_COVERAGE_SETS_TABLE,
  BILLING_SOURCE_COVERAGE_SLICES_TABLE,
  BILLING_SOURCE_PERIODS_TABLE,
  BILLING_SOURCE_PERIOD_VERSIONS_TABLE,
  BILLING_SOURCE_RENTAL_LINES_TABLE,
  BILLING_SOURCE_SNAPSHOTS_TABLE,
  BILLING_SOURCE_UPD_LINES_TABLE,
  BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE,
  BILLING_SOURCE_UPDS_TABLE,
  BILLING_SOURCE_UPD_VERSIONS_TABLE,
  assertBillingSourceAuthorityStructure,
} = require('./billing-source-authority-schema');
const {
  FORECAST_RECEIVABLES_PLANNING_MIGRATION_ID,
  FORECAST_RECEIVABLES_PLANNING_SCHEMA_VERSION,
  assertForecastReceivablesPlanningStructure,
} = require('./forecast-receivables-planning-schema');

const ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_SCHEMA_VERSION = 1;
const ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID = 'actual_source_eligibility_dry_run_pr8';

const ACTUAL_SOURCE_DRY_RUNS_TABLE = 'actual_source_dry_runs';
const ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE = 'actual_source_dry_run_inputs';
const ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE = 'actual_source_dry_run_candidates';
const ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE = 'actual_source_dry_run_checks';
const ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE = 'actual_source_dry_run_reconciliations';
const ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE = 'actual_source_dry_run_diagnostics';
const ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE = 'actual_source_dry_run_operations';
const ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE = 'actual_source_dry_run_audit_events';

const ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES = Object.freeze([
  ACTUAL_SOURCE_DRY_RUNS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE,
]);

const REQUIRED_COLUMNS = Object.freeze({
  [ACTUAL_SOURCE_DRY_RUNS_TABLE]: [
    'id', 'companyId', 'branchId', 'companyTimezone', 'asOfDate', 'evaluatorVersion',
    'schemaVersion', 'policyManifestJson', 'policyManifestHash', 'sourceInputManifestJson',
    'sourceInputManifestHash', 'sourceInputCount', 'candidateCount', 'checkCount',
    'reconciliationCount', 'diagnosticCount', 'eligibleCandidateCount',
    'blockedCandidateCount', 'runNetMinor', 'runVatMinor', 'runGrossMinor',
    'eligibleCandidateNetMinor', 'eligibleCandidateVatMinor', 'eligibleCandidateGrossMinor',
    'resultHash', 'status', 'diagnosticOnly', 'canonicalWriteAuthorized',
    'productionActivationAuthorized', 'correlationId', 'operationId', 'createdAt', 'finalizedAt',
  ],
  [ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE]: [
    'id', 'runId', 'companyId', 'branchId', 'sourceKind', 'sourceTableIdentity',
    'sourceId', 'sourceVersion', 'externalAssertionHash', 'normalizedInputHash',
    'sourceState', 'deterministicOrderKey', 'activationBoundaryId', 'rentalLineId',
    'periodId', 'closedPeriodVersionId', 'snapshotId', 'updId', 'updVersionId',
    'updLineId', 'updLineVersionId', 'coverageSetId', 'coverageSliceId',
    'sourceOperationId', 'relationshipJson', 'schemaVersion', 'createdAt',
  ],
  [ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE]: [
    'id', 'runId', 'companyId', 'branchId', 'candidateKey', 'activationBoundaryId',
    'rentalLineId', 'rentalId', 'clientId', 'contractId', 'periodId',
    'closedPeriodVersionId', 'snapshotId', 'updId', 'formedUpdVersionId',
    'currentConductedUpdVersionId', 'updLineId', 'updLineVersionId', 'coverageSetId',
    'coverageSliceId', 'sliceStartDate', 'sliceEndDateExclusive', 'sourceNetMinor',
    'sourceVatMinor', 'sourceGrossMinor', 'currency', 'contractualDueDate',
    'dueDateProvenance', 'dueDateEvidenceRef', 'proposedOriginalAmountMinor', 'status',
    'blockerCodesJson', 'policyManifestHash', 'inputLineageHash', 'resultHash',
    'diagnosticOnly', 'canonicalWriteAuthorized', 'productionActivationAuthorized',
    'schemaVersion', 'createdAt',
  ],
  [ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE]: [
    'id', 'runId', 'candidateId', 'companyId', 'branchId', 'gateCode', 'outcome',
    'policyDecisionRef', 'policyDecisionVersion', 'policyDecisionHash',
    'sourceEvidenceRefsJson', 'expectedFingerprint', 'observedFingerprint',
    'reasonCode', 'checkHash', 'schemaVersion', 'createdAt',
  ],
  [ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE]: [
    'id', 'runId', 'candidateId', 'companyId', 'branchId', 'dimensionKind',
    'dimensionIdsJson', 'expectedNetMinor', 'expectedVatMinor', 'expectedGrossMinor',
    'observedNetMinor', 'observedVatMinor', 'observedGrossMinor', 'deltaNetMinor',
    'deltaVatMinor', 'deltaGrossMinor', 'currency', 'reconciliationRuleVersion',
    'sourceInputHash', 'blockerState', 'reconciliationHash', 'schemaVersion', 'createdAt',
  ],
  [ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE]: [
    'id', 'runId', 'candidateId', 'companyId', 'branchId', 'severity', 'code',
    'sourceKind', 'sourceId', 'sourceVersion', 'affectedStartDate',
    'affectedEndDateExclusive', 'expectedEvidenceJson', 'observedEvidenceJson',
    'policyReferencesJson', 'detectedAt', 'detectorVersion', 'diagnosticHash',
    'schemaVersion',
  ],
  [ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE]: [
    'id', 'companyId', 'branchId', 'operationType', 'idempotencyKey',
    'commandFingerprint', 'policyManifestHash', 'inputSetHash', 'actorPrincipalId',
    'actorMembershipId', 'actorMembershipVersion', 'roleTemplateKey',
    'roleTemplateVersion', 'capabilityCatalogVersion', 'capabilityKey', 'resultRunId',
    'resultHash', 'auditEventId', 'correlationId', 'schemaVersion', 'createdAt',
  ],
  [ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE]: [
    'id', 'companyId', 'branchId', 'aggregateType', 'aggregateId', 'aggregateVersion',
    'eventType', 'actorType', 'actorPrincipalId', 'actorMembershipId',
    'actorMembershipVersion', 'roleTemplateKey', 'roleTemplateVersion',
    'capabilityCatalogVersion', 'capabilityKey', 'correlationId', 'reasonCode',
    'reasonText', 'beforeFingerprint', 'afterFingerprint', 'inputSetHash', 'resultHash',
    'inputCount', 'candidateCount', 'checkCount', 'reconciliationCount',
    'diagnosticCount', 'operationId', 'schemaVersion', 'createdAt',
  ],
});

const CRITICAL_TABLE_CHECKS = Object.freeze({
  [ACTUAL_SOURCE_DRY_RUNS_TABLE]: [
    "lower(branchId) NOT IN ('*', 'all', 'global', 'company-wide', 'company_wide', 'any', 'null')",
    'date(asOfDate) = asOfDate',
    "json_valid(policyManifestJson) AND json_type(policyManifestJson) = 'object'",
    "json_valid(sourceInputManifestJson) AND json_type(sourceInputManifestJson) = 'array'",
    'length(policyManifestHash) = 64 AND length(sourceInputManifestHash) = 64 AND length(resultHash) = 64',
    "typeof(sourceInputCount) = 'integer' AND sourceInputCount >= 0",
    "typeof(candidateCount) = 'integer' AND candidateCount >= 0",
    "typeof(checkCount) = 'integer' AND checkCount >= 0",
    "typeof(reconciliationCount) = 'integer' AND reconciliationCount >= 0",
    "typeof(diagnosticCount) = 'integer' AND diagnosticCount >= 0",
    "typeof(eligibleCandidateCount) = 'integer' AND eligibleCandidateCount >= 0",
    "typeof(blockedCandidateCount) = 'integer' AND blockedCandidateCount >= 0",
    'candidateCount = eligibleCandidateCount + blockedCandidateCount',
    "typeof(runNetMinor) = 'integer' AND runNetMinor BETWEEN 0 AND 9007199254740991",
    "typeof(runVatMinor) = 'integer' AND runVatMinor BETWEEN 0 AND 9007199254740991",
    "typeof(runGrossMinor) = 'integer' AND runGrossMinor BETWEEN 0 AND 9007199254740991",
    'runNetMinor + runVatMinor = runGrossMinor',
    "typeof(eligibleCandidateNetMinor) = 'integer' AND eligibleCandidateNetMinor BETWEEN 0 AND 9007199254740991",
    "typeof(eligibleCandidateVatMinor) = 'integer' AND eligibleCandidateVatMinor BETWEEN 0 AND 9007199254740991",
    "typeof(eligibleCandidateGrossMinor) = 'integer' AND eligibleCandidateGrossMinor BETWEEN 0 AND 9007199254740991",
    'eligibleCandidateNetMinor + eligibleCandidateVatMinor = eligibleCandidateGrossMinor',
    "status IN ('completed', 'completed_with_blockers', 'completed_no_candidates')",
    "(status = 'completed' AND candidateCount > 0 AND blockedCandidateCount = 0) OR (status = 'completed_with_blockers' AND (blockedCandidateCount > 0 OR diagnosticCount > 0)) OR (status = 'completed_no_candidates' AND candidateCount = 0)",
    'diagnosticOnly = 1 AND canonicalWriteAuthorized = 0 AND productionActivationAuthorized = 0',
    "createdAt GLOB '????-??-??T??:??:??.???Z'",
    'finalizedAt = createdAt',
    'schemaVersion = 1',
  ],
  [ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE]: [
    'sourceTableIdentity = sourceKind',
    'length(trim(sourceId)) > 0',
    "sourceVersion IS NULL OR (typeof(sourceVersion) = 'integer' AND sourceVersion >= 1)",
    'externalAssertionHash IS NULL OR length(externalAssertionHash) = 64',
    'length(normalizedInputHash) = 64 AND length(deterministicOrderKey) = 64',
    "json_valid(relationshipJson) AND json_type(relationshipJson) = 'object'",
    "createdAt GLOB '????-??-??T??:??:??.???Z'",
    'schemaVersion = 1',
  ],
  [ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE]: [
    'length(candidateKey) = 64 AND length(policyManifestHash) = 64 AND length(inputLineageHash) = 64 AND length(resultHash) = 64',
    'date(sliceStartDate) = sliceStartDate AND date(sliceEndDateExclusive) = sliceEndDateExclusive AND sliceStartDate < sliceEndDateExclusive',
    "typeof(sourceNetMinor) = 'integer' AND sourceNetMinor BETWEEN 0 AND 9007199254740991",
    "typeof(sourceVatMinor) = 'integer' AND sourceVatMinor BETWEEN 0 AND 9007199254740991",
    "typeof(sourceGrossMinor) = 'integer' AND sourceGrossMinor BETWEEN 0 AND 9007199254740991",
    'sourceNetMinor + sourceVatMinor = sourceGrossMinor',
    "currency = 'RUB'",
    "dueDateProvenance IN ('invoice_due_date', 'contractual_payment_due_date', 'installment_due_date', 'unknown')",
    "(dueDateProvenance = 'unknown' AND contractualDueDate IS NULL AND dueDateEvidenceRef IS NULL) OR (dueDateProvenance != 'unknown' AND date(contractualDueDate) = contractualDueDate AND length(trim(dueDateEvidenceRef)) > 0)",
    "proposedOriginalAmountMinor IS NULL OR (typeof(proposedOriginalAmountMinor) = 'integer' AND proposedOriginalAmountMinor BETWEEN 0 AND 9007199254740991)",
    "status IN ('eligible_candidate', 'blocked')",
    "json_valid(blockerCodesJson) AND json_type(blockerCodesJson) = 'array'",
    "(status = 'eligible_candidate' AND json_array_length(blockerCodesJson) = 0 AND sourceGrossMinor > 0 AND currentConductedUpdVersionId IS NOT NULL AND proposedOriginalAmountMinor IS NOT NULL) OR (status = 'blocked' AND json_array_length(blockerCodesJson) > 0)",
    'diagnosticOnly = 1 AND canonicalWriteAuthorized = 0 AND productionActivationAuthorized = 0',
    "createdAt GLOB '????-??-??T??:??:??.???Z'",
    'schemaVersion = 1',
  ],
  [ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE]: [
    'candidateId IS NULL OR length(trim(candidateId)) > 0',
    "outcome IN ('passed', 'blocked', 'not_applicable')",
    "policyDecisionVersion IS NULL OR (typeof(policyDecisionVersion) = 'integer' AND policyDecisionVersion >= 1)",
    'policyDecisionHash IS NULL OR length(policyDecisionHash) = 64',
    "json_valid(sourceEvidenceRefsJson) AND json_type(sourceEvidenceRefsJson) = 'array'",
    'expectedFingerprint IS NULL OR length(expectedFingerprint) = 64',
    'observedFingerprint IS NULL OR length(observedFingerprint) = 64',
    "(outcome = 'blocked' AND length(trim(reasonCode)) > 0) OR outcome != 'blocked'",
    'length(checkHash) = 64',
    "createdAt GLOB '????-??-??T??:??:??.???Z'",
    'schemaVersion = 1',
  ],
  [ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE]: [
    'candidateId IS NULL OR length(trim(candidateId)) > 0',
    "dimensionKind IN ('snapshot_equation', 'upd_line_equation', 'coverage_slice_equation', 'upd_line_aggregate', 'closed_period_snapshot_aggregate', 'coverage_set_delta')",
    "json_valid(dimensionIdsJson) AND json_type(dimensionIdsJson) = 'object'",
    "typeof(expectedNetMinor) = 'integer' AND typeof(expectedVatMinor) = 'integer' AND typeof(expectedGrossMinor) = 'integer'",
    "typeof(observedNetMinor) = 'integer' AND typeof(observedVatMinor) = 'integer' AND typeof(observedGrossMinor) = 'integer'",
    "typeof(deltaNetMinor) = 'integer' AND typeof(deltaVatMinor) = 'integer' AND typeof(deltaGrossMinor) = 'integer'",
    "currency = 'RUB'",
    'length(sourceInputHash) = 64 AND length(reconciliationHash) = 64',
    'blockerState IN (0, 1)',
    '(blockerState = 0 AND deltaNetMinor = 0 AND deltaVatMinor = 0 AND deltaGrossMinor = 0) OR blockerState = 1',
    "createdAt GLOB '????-??-??T??:??:??.???Z'",
    'schemaVersion = 1',
  ],
  [ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE]: [
    'candidateId IS NULL OR length(trim(candidateId)) > 0',
    "severity IN ('blocking', 'info')",
    'length(trim(code)) > 0',
    "sourceVersion IS NULL OR (typeof(sourceVersion) = 'integer' AND sourceVersion >= 1)",
    '(affectedStartDate IS NULL AND affectedEndDateExclusive IS NULL) OR (date(affectedStartDate) = affectedStartDate AND date(affectedEndDateExclusive) = affectedEndDateExclusive AND affectedStartDate < affectedEndDateExclusive)',
    'json_valid(expectedEvidenceJson) AND json_valid(observedEvidenceJson) AND json_valid(policyReferencesJson)',
    "detectedAt GLOB '????-??-??T??:??:??.???Z'",
    'length(diagnosticHash) = 64',
    'schemaVersion = 1',
  ],
  [ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE]: [
    "operationType = 'evaluate_actual_source_dry_run'",
    "capabilityKey = 'receivables.read'",
    'length(commandFingerprint) = 64 AND length(policyManifestHash) = 64 AND length(inputSetHash) = 64 AND length(resultHash) = 64',
    "typeof(actorMembershipVersion) = 'integer' AND actorMembershipVersion >= 1",
    "typeof(roleTemplateVersion) = 'integer' AND roleTemplateVersion >= 1",
    "typeof(capabilityCatalogVersion) = 'integer' AND capabilityCatalogVersion = 1",
    "createdAt GLOB '????-??-??T??:??:??.???Z'",
    'schemaVersion = 1',
  ],
  [ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE]: [
    "aggregateType = 'actual_source_dry_run' AND aggregateVersion = 1",
    "eventType = 'actual_source_dry_run_evaluated' AND actorType = 'user'",
    "capabilityKey = 'receivables.read'",
    'beforeFingerprint IS NULL OR length(beforeFingerprint) = 64',
    'length(afterFingerprint) = 64 AND length(inputSetHash) = 64 AND length(resultHash) = 64',
    "typeof(inputCount) = 'integer' AND inputCount >= 0",
    "typeof(candidateCount) = 'integer' AND candidateCount >= 0",
    "typeof(checkCount) = 'integer' AND checkCount >= 0",
    "typeof(reconciliationCount) = 'integer' AND reconciliationCount >= 0",
    "typeof(diagnosticCount) = 'integer' AND diagnosticCount >= 0",
    "createdAt GLOB '????-??-??T??:??:??.???Z'",
    'schemaVersion = 1',
  ],
});

const EXPECTED_INDEX_DEFINITIONS = Object.freeze({
  uq_actual_source_input_identity: `CREATE UNIQUE INDEX uq_actual_source_input_identity
    ON ${ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE}(runId, sourceKind, sourceId);`,
  uq_actual_source_candidate_key: `CREATE UNIQUE INDEX uq_actual_source_candidate_key
    ON ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE}(runId, candidateKey);`,
  uq_actual_source_check_identity: `CREATE UNIQUE INDEX uq_actual_source_check_identity
    ON ${ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE}(runId, ifnull(candidateId, ''), gateCode);`,
  uq_actual_source_reconciliation_identity: `CREATE UNIQUE INDEX uq_actual_source_reconciliation_identity
    ON ${ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE}(runId, ifnull(candidateId, ''), dimensionKind, dimensionIdsJson);`,
  uq_actual_source_diagnostic_identity: `CREATE UNIQUE INDEX uq_actual_source_diagnostic_identity
    ON ${ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE}(runId, ifnull(candidateId, ''), diagnosticHash);`,
  uq_actual_source_operation_identity: `CREATE UNIQUE INDEX uq_actual_source_operation_identity
    ON ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE}(companyId, operationType, idempotencyKey);`,
  uq_actual_source_operation_result: `CREATE UNIQUE INDEX uq_actual_source_operation_result
    ON ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE}(resultRunId);`,
  idx_actual_source_runs_scope: `CREATE INDEX idx_actual_source_runs_scope
    ON ${ACTUAL_SOURCE_DRY_RUNS_TABLE}(companyId, branchId, createdAt, id);`,
  idx_actual_source_candidates_scope: `CREATE INDEX idx_actual_source_candidates_scope
    ON ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE}(companyId, branchId, runId, status, candidateKey);`,
  idx_actual_source_checks_scope: `CREATE INDEX idx_actual_source_checks_scope
    ON ${ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE}(companyId, branchId, runId, candidateId, gateCode);`,
  idx_actual_source_reconciliations_scope: `CREATE INDEX idx_actual_source_reconciliations_scope
    ON ${ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE}(companyId, branchId, runId, candidateId, dimensionKind);`,
  idx_actual_source_diagnostics_scope: `CREATE INDEX idx_actual_source_diagnostics_scope
    ON ${ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE}(companyId, branchId, runId, candidateId, code);`,
  idx_actual_source_inputs_scope: `CREATE INDEX idx_actual_source_inputs_scope
    ON ${ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE}(companyId, branchId, runId, sourceKind, deterministicOrderKey);`,
  idx_actual_source_audit_scope: `CREATE INDEX idx_actual_source_audit_scope
    ON ${ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE}(companyId, branchId, aggregateId, createdAt, id);`,
});

const EXPECTED_INDEX_METADATA = Object.freeze({
  uq_actual_source_input_identity: { table: ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE, unique: 1, columns: ['runId', 'sourceKind', 'sourceId'] },
  uq_actual_source_candidate_key: { table: ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE, unique: 1, columns: ['runId', 'candidateKey'] },
  uq_actual_source_check_identity: { table: ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE, unique: 1, columns: ['runId', null, 'gateCode'] },
  uq_actual_source_reconciliation_identity: { table: ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE, unique: 1, columns: ['runId', null, 'dimensionKind', 'dimensionIdsJson'] },
  uq_actual_source_diagnostic_identity: { table: ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE, unique: 1, columns: ['runId', null, 'diagnosticHash'] },
  uq_actual_source_operation_identity: { table: ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE, unique: 1, columns: ['companyId', 'operationType', 'idempotencyKey'] },
  uq_actual_source_operation_result: { table: ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE, unique: 1, columns: ['resultRunId'] },
  idx_actual_source_runs_scope: { table: ACTUAL_SOURCE_DRY_RUNS_TABLE, unique: 0, columns: ['companyId', 'branchId', 'createdAt', 'id'] },
  idx_actual_source_candidates_scope: { table: ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE, unique: 0, columns: ['companyId', 'branchId', 'runId', 'status', 'candidateKey'] },
  idx_actual_source_checks_scope: { table: ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE, unique: 0, columns: ['companyId', 'branchId', 'runId', 'candidateId', 'gateCode'] },
  idx_actual_source_reconciliations_scope: { table: ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE, unique: 0, columns: ['companyId', 'branchId', 'runId', 'candidateId', 'dimensionKind'] },
  idx_actual_source_diagnostics_scope: { table: ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE, unique: 0, columns: ['companyId', 'branchId', 'runId', 'candidateId', 'code'] },
  idx_actual_source_inputs_scope: { table: ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE, unique: 0, columns: ['companyId', 'branchId', 'runId', 'sourceKind', 'deterministicOrderKey'] },
  idx_actual_source_audit_scope: { table: ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE, unique: 0, columns: ['companyId', 'branchId', 'aggregateId', 'createdAt', 'id'] },
});

const EXPECTED_UNIQUE_KEYS = Object.freeze({
  [ACTUAL_SOURCE_DRY_RUNS_TABLE]: [
    ['id'],
    ['id', 'companyId', 'branchId'],
    ['operationId', 'companyId', 'branchId'],
  ],
  [ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE]: [
    ['id'],
    ['id', 'companyId', 'branchId'],
    ['runId', 'sourceKind', 'sourceId'],
  ],
  [ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE]: [
    ['id'],
    ['id', 'runId', 'companyId', 'branchId'],
    ['runId', 'candidateKey'],
  ],
  [ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE]: [
    ['id'],
    ['id', 'companyId', 'branchId'],
    ['runId', null, 'gateCode'],
  ],
  [ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE]: [
    ['id'],
    ['id', 'companyId', 'branchId'],
    ['runId', null, 'dimensionKind', 'dimensionIdsJson'],
  ],
  [ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE]: [
    ['id'],
    ['id', 'companyId', 'branchId'],
    ['runId', null, 'diagnosticHash'],
  ],
  [ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE]: [
    ['id'],
    ['id', 'companyId', 'branchId'],
    ['auditEventId', 'companyId', 'branchId'],
    ['companyId', 'operationType', 'idempotencyKey'],
    ['resultRunId'],
  ],
  [ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE]: [
    ['id'],
    ['id', 'companyId', 'branchId'],
  ],
});

const REQUIRED_INDEXES = Object.freeze(Object.keys(EXPECTED_INDEX_DEFINITIONS));

const REQUIRED_TRIGGERS = Object.freeze([
  ...ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES.flatMap(table => [
    `trg_${table}_no_update`,
    `trg_${table}_no_delete`,
  ]),
  'trg_actual_source_dry_run_operations_no_replace',
  'trg_actual_source_dry_run_audit_events_no_replace',
  'trg_actual_source_input_before_seal',
  'trg_actual_source_candidate_before_seal',
  'trg_actual_source_check_before_seal',
  'trg_actual_source_reconciliation_before_seal',
  'trg_actual_source_diagnostic_before_seal',
  'trg_actual_source_audit_before_seal',
  'trg_actual_source_operation_finalize_run',
]);

function foreignKey(from, table, to) {
  return Object.freeze({
    table,
    from: Object.freeze(from),
    to: Object.freeze(to),
    onUpdate: 'RESTRICT',
    onDelete: 'RESTRICT',
    match: 'NONE',
  });
}

const ROOT_FOREIGN_KEYS = Object.freeze([
  foreignKey(['companyId'], CANONICAL_COMPANIES_TABLE, ['id']),
  foreignKey(['companyId', 'branchId'], CANONICAL_BRANCHES_TABLE, ['companyId', 'id']),
]);

const EXPECTED_FOREIGN_KEYS = Object.freeze({
  [ACTUAL_SOURCE_DRY_RUNS_TABLE]: [
    ...ROOT_FOREIGN_KEYS,
    foreignKey(['operationId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE, ['id', 'companyId', 'branchId']),
  ],
  [ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE]: [
    ...ROOT_FOREIGN_KEYS,
    foreignKey(['runId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUNS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['activationBoundaryId', 'companyId', 'branchId'], BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE, ['id', 'companyId', 'branchId']),
  ],
  [ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE]: [
    ...ROOT_FOREIGN_KEYS,
    foreignKey(['runId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUNS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['activationBoundaryId', 'companyId', 'branchId'], BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['rentalLineId', 'companyId', 'branchId'], BILLING_SOURCE_RENTAL_LINES_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['periodId', 'companyId', 'branchId'], BILLING_SOURCE_PERIODS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['closedPeriodVersionId', 'companyId', 'branchId'], BILLING_SOURCE_PERIOD_VERSIONS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['snapshotId', 'companyId', 'branchId'], BILLING_SOURCE_SNAPSHOTS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['updId', 'companyId', 'branchId'], BILLING_SOURCE_UPDS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['formedUpdVersionId', 'companyId', 'branchId'], BILLING_SOURCE_UPD_VERSIONS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['currentConductedUpdVersionId', 'companyId', 'branchId'], BILLING_SOURCE_UPD_VERSIONS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['updLineId', 'companyId', 'branchId'], BILLING_SOURCE_UPD_LINES_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['updLineVersionId', 'companyId', 'branchId'], BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['coverageSetId', 'companyId', 'branchId'], BILLING_SOURCE_COVERAGE_SETS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['coverageSliceId', 'companyId', 'branchId'], BILLING_SOURCE_COVERAGE_SLICES_TABLE, ['id', 'companyId', 'branchId']),
  ],
  [ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE]: [
    ...ROOT_FOREIGN_KEYS,
    foreignKey(['runId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUNS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['candidateId', 'runId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE, ['id', 'runId', 'companyId', 'branchId']),
  ],
  [ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE]: [
    ...ROOT_FOREIGN_KEYS,
    foreignKey(['runId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUNS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['candidateId', 'runId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE, ['id', 'runId', 'companyId', 'branchId']),
  ],
  [ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE]: [
    ...ROOT_FOREIGN_KEYS,
    foreignKey(['runId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUNS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['candidateId', 'runId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE, ['id', 'runId', 'companyId', 'branchId']),
  ],
  [ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE]: [
    ...ROOT_FOREIGN_KEYS,
    foreignKey(['actorMembershipId', 'companyId'], COMPANY_MEMBERSHIPS_TABLE, ['id', 'companyId']),
    foreignKey(['capabilityCatalogVersion', 'capabilityKey'], CAPABILITY_CATALOG_ENTRIES_TABLE, ['catalogVersion', 'capabilityKey']),
    foreignKey(['resultRunId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUNS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['auditEventId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE, ['id', 'companyId', 'branchId']),
  ],
  [ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE]: [
    ...ROOT_FOREIGN_KEYS,
    foreignKey(['operationId', 'companyId', 'branchId'], ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE, ['id', 'companyId', 'branchId']),
    foreignKey(['actorMembershipId', 'companyId'], COMPANY_MEMBERSHIPS_TABLE, ['id', 'companyId']),
    foreignKey(['capabilityCatalogVersion', 'capabilityKey'], CAPABILITY_CATALOG_ENTRIES_TABLE, ['catalogVersion', 'capabilityKey']),
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
    SELECT name, version, applied_at FROM sql_shadow_schema_migrations WHERE name = ?
  `).get(name) || null;
}

function assertMigration(db, name, version) {
  const row = migrationRow(db, name);
  if (Number(row?.version) !== version) {
    throw new Error(`ACTUAL_SOURCE_PR8_PREREQUISITE_REQUIRED:${name}:v${version}`);
  }
}

function assertForeignKeysEnabled(db) {
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('ACTUAL_SOURCE_PR8_FOREIGN_KEYS_REQUIRED');
  }
}

function assertForeignKeyCheckClean(db) {
  const failures = db.pragma('foreign_key_check');
  if (failures.length > 0) {
    throw new Error(`ACTUAL_SOURCE_PR8_FOREIGN_KEY_CHECK_FAILED:${JSON.stringify(failures)}`);
  }
}

function assertNoCompetingRoots(db) {
  for (const table of ['companies', 'branches']) {
    if (tableExists(db, table)) throw new Error(`ACTUAL_SOURCE_PR8_COMPETING_AUTHORITY:${table}`);
  }
}

function assertNoCanonicalFinancialRows(db) {
  for (const table of FINANCIAL_TABLES) {
    const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    if (count !== 0) throw new Error(`ACTUAL_SOURCE_PR8_CANONICAL_ROWS_PRESENT:${table}:${count}`);
  }
}

function assertCapabilityCatalogExact(db) {
  const versions = db.prepare('SELECT version, status FROM capability_catalog_versions ORDER BY version').all();
  if (versions.length !== 1 || Number(versions[0].version) !== 1 || versions[0].status !== 'active') {
    throw new Error('ACTUAL_SOURCE_PR8_CAPABILITY_CATALOG_MISMATCH');
  }
  const actual = db.prepare(`
    SELECT capabilityKey, scopeKind, assignable, status
    FROM capability_catalog_entries WHERE catalogVersion = 1 ORDER BY capabilityKey
  `).all();
  const expected = CAPABILITY_CATALOG_V1.map(entry => ({
    capabilityKey: entry.key,
    scopeKind: entry.scopeKind,
    assignable: entry.assignable ? 1 : 0,
    status: 'active',
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('ACTUAL_SOURCE_PR8_CAPABILITY_CATALOG_MISMATCH');
  }
}

function hasUnexpectedPartialState(db) {
  if (ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES.some(table => tableExists(db, table))) return true;
  return db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE name LIKE 'uq_actual_source_%'
       OR name LIKE 'idx_actual_source_%'
       OR name LIKE 'trg_actual_source_%'
    LIMIT 1
  `).get() != null;
}

function canonicalForeignKeys(db, table) {
  const groups = new Map();
  for (const row of db.prepare(`PRAGMA foreign_key_list(${table})`).all()) {
    if (!groups.has(row.id)) groups.set(row.id, []);
    groups.get(row.id).push(row);
  }
  return [...groups.values()].map(rows => {
    const ordered = [...rows].sort((left, right) => Number(left.seq) - Number(right.seq));
    return {
      table: ordered[0].table,
      from: ordered.map(row => row.from),
      to: ordered.map(row => row.to),
      onUpdate: ordered[0].on_update,
      onDelete: ordered[0].on_delete,
      match: ordered[0].match,
    };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function assertExactForeignKeys(db) {
  for (const [table, expected] of Object.entries(EXPECTED_FOREIGN_KEYS)) {
    const actual = canonicalForeignKeys(db, table);
    const canonicalExpected = [...expected]
      .map(item => ({ ...item, from: [...item.from], to: [...item.to] }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    if (JSON.stringify(actual) !== JSON.stringify(canonicalExpected)) {
      throw new Error(`ACTUAL_SOURCE_PR8_FOREIGN_KEY_STRUCTURE_MISMATCH:${table}`);
    }
  }
}

function canonicalSql(value) {
  const sql = String(value || '');
  let result = '';
  let quote = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      result += character;
      if (character === quote) {
        if (sql[index + 1] === quote) {
          result += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'") {
      quote = character;
      result += character;
    } else if (!/\s/.test(character)) {
      result += character.toLowerCase();
    }
  }
  if (quote) return null;
  return result.replace(/;+$/, '');
}

function extractCheckExpressions(sql) {
  const expressions = [];
  const pattern = /\bCHECK\s*\(/gi;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const openIndex = match.index + match[0].lastIndexOf('(');
    let depth = 0;
    let quote = null;
    let closeIndex = -1;
    for (let index = openIndex; index < sql.length; index += 1) {
      const character = sql[index];
      if (quote) {
        if (character === quote) {
          if (sql[index + 1] === quote) index += 1;
          else quote = null;
        }
        continue;
      }
      if (character === "'") quote = character;
      else if (character === '(') depth += 1;
      else if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          closeIndex = index;
          break;
        }
      }
    }
    if (closeIndex < 0 || quote) return null;
    expressions.push(sql.slice(openIndex + 1, closeIndex));
    pattern.lastIndex = closeIndex + 1;
  }
  return expressions;
}

function canonicalList(values) {
  return values.map(canonicalSql).sort();
}

function assertExactCriticalChecks(db) {
  for (const [table, expectedChecks] of Object.entries(CRITICAL_TABLE_CHECKS)) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    const actualChecks = row ? extractCheckExpressions(row.sql) : null;
    const canonicalActual = actualChecks ? canonicalList(actualChecks) : null;
    if (
      !canonicalActual
      || canonicalActual.includes(null)
      || JSON.stringify(canonicalActual) !== JSON.stringify(canonicalList(expectedChecks))
    ) {
      throw new Error(`ACTUAL_SOURCE_PR8_TABLE_CONSTRAINT_MISMATCH:${table}`);
    }
  }
}

function assertExactUniqueKeys(db) {
  for (const [table, expectedKeys] of Object.entries(EXPECTED_UNIQUE_KEYS)) {
    const actual = db.prepare(`PRAGMA index_list(${table})`).all()
      .filter(index => Number(index.unique) === 1)
      .map(index => ({
        columns: db.prepare(`PRAGMA index_info(${index.name})`).all()
          .sort((left, right) => Number(left.seqno) - Number(right.seqno))
          .map(row => row.name),
        partial: Number(index.partial),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const expected = expectedKeys.map(columns => ({ columns, partial: 0 }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`ACTUAL_SOURCE_PR8_INDEX_STRUCTURE_MISMATCH:${table}:unique_keys`);
    }
  }
}

function assertExactIndexStructure(db) {
  for (const [name, expectedSql] of Object.entries(EXPECTED_INDEX_DEFINITIONS)) {
    const metadata = EXPECTED_INDEX_METADATA[name];
    const row = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(name);
    const index = db.prepare(`PRAGMA index_list(${metadata.table})`).all()
      .find(item => item.name === name);
    const info = row ? db.prepare(`PRAGMA index_info(${name})`).all()
      .sort((left, right) => Number(left.seqno) - Number(right.seqno)) : [];
    const keyInfo = row ? db.prepare(`PRAGMA index_xinfo(${name})`).all()
      .filter(item => Number(item.key) === 1)
      .sort((left, right) => Number(left.seqno) - Number(right.seqno)) : [];
    const expectedKeyInfo = metadata.columns.map(column => ({
      name: column,
      desc: 0,
      coll: 'BINARY',
    }));
    if (
      !row
      || row.tbl_name !== metadata.table
      || canonicalSql(row.sql) !== canonicalSql(expectedSql)
      || !index
      || Number(index.unique) !== metadata.unique
      || Number(index.partial) !== 0
      || JSON.stringify(info.map(item => item.name)) !== JSON.stringify(metadata.columns)
      || JSON.stringify(keyInfo.map(item => ({
        name: item.name,
        desc: Number(item.desc),
        coll: item.coll,
      }))) !== JSON.stringify(expectedKeyInfo)
    ) {
      throw new Error(`ACTUAL_SOURCE_PR8_INDEX_STRUCTURE_MISMATCH:${name}`);
    }
  }
}

function assertExactTriggerStructure(db) {
  for (const [name, expectedSql] of Object.entries(expectedTriggerDefinitions())) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .get(name);
    if (!row || canonicalSql(row.sql) !== canonicalSql(expectedSql)) {
      throw new Error(`ACTUAL_SOURCE_PR8_TRIGGER_STRUCTURE_MISMATCH:${name}`);
    }
  }
}

function assertActualSourceEligibilityDryRunStructure(db, { requireMigration = true } = {}) {
  assertForeignKeysEnabled(db);
  assertNoCompetingRoots(db);
  assertPlatformIdentityStructure(db);
  assertBillingSourceAuthorityStructure(db);
  assertForecastReceivablesPlanningStructure(db);
  assertCapabilityCatalogExact(db);
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!tableExists(db, table)) throw new Error(`ACTUAL_SOURCE_PR8_SCHEMA_INCOMPLETE:${table}`);
    const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    if (JSON.stringify(actual) !== JSON.stringify(columns)) {
      throw new Error(`ACTUAL_SOURCE_PR8_SCHEMA_INCOMPLETE:${table}:columns`);
    }
  }
  for (const index of REQUIRED_INDEXES) {
    if (!objectExists(db, 'index', index)) throw new Error(`ACTUAL_SOURCE_PR8_SCHEMA_INCOMPLETE:${index}`);
  }
  for (const trigger of REQUIRED_TRIGGERS) {
    if (!objectExists(db, 'trigger', trigger)) throw new Error(`ACTUAL_SOURCE_PR8_SCHEMA_INCOMPLETE:${trigger}`);
  }
  assertExactForeignKeys(db);
  assertExactCriticalChecks(db);
  assertExactIndexStructure(db);
  assertExactUniqueKeys(db);
  assertExactTriggerStructure(db);
  if (requireMigration) {
    const row = migrationRow(db, ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID);
    if (Number(row?.version) !== ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_SCHEMA_VERSION) {
      throw new Error('ACTUAL_SOURCE_PR8_MIGRATION_REGISTRY_MISMATCH');
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

function immutableTriggersSql(table) {
  return `${immutableUpdateTriggerSql(table)}\n${immutableDeleteTriggerSql(table)}`;
}

function noReplaceTriggerSql(name, table, message) {
  return `
    CREATE TRIGGER ${name}
    BEFORE INSERT ON ${table}
    WHEN EXISTS (SELECT 1 FROM ${table} WHERE id = NEW.id)
    BEGIN
      SELECT RAISE(ABORT, '${message}');
    END;
  `;
}

function beforeSealTriggerSql(name, table, runColumn) {
  return `
    CREATE TRIGGER ${name}
    BEFORE INSERT ON ${table}
    WHEN EXISTS (
      SELECT 1 FROM ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE} operation
      WHERE operation.resultRunId = NEW.${runColumn}
    )
    BEGIN
      SELECT RAISE(ABORT, 'actual source dry run is sealed');
    END;
  `;
}

function auditBeforeSealTriggerSql() {
  return `
    CREATE TRIGGER trg_actual_source_audit_before_seal
    BEFORE INSERT ON ${ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE}
    WHEN EXISTS (
      SELECT 1 FROM ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE} operation
      WHERE operation.resultRunId = NEW.aggregateId
    )
    BEGIN
      SELECT RAISE(ABORT, 'actual source dry run is sealed');
    END;
  `;
}

function operationFinalizeTriggerSql() {
  return `
    CREATE TRIGGER trg_actual_source_operation_finalize_run
    BEFORE INSERT ON ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE}
    WHEN NOT EXISTS (
      SELECT 1
      FROM ${ACTUAL_SOURCE_DRY_RUNS_TABLE} run
      JOIN ${ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE} audit
        ON audit.id = NEW.auditEventId
       AND audit.companyId = NEW.companyId
       AND audit.branchId = NEW.branchId
       AND audit.aggregateId = NEW.resultRunId
       AND audit.operationId = NEW.id
      WHERE run.id = NEW.resultRunId
        AND run.companyId = NEW.companyId
        AND run.branchId = NEW.branchId
        AND run.operationId = NEW.id
        AND run.policyManifestHash = NEW.policyManifestHash
        AND run.sourceInputManifestHash = NEW.inputSetHash
        AND run.resultHash = NEW.resultHash
        AND audit.inputSetHash = NEW.inputSetHash
        AND audit.resultHash = NEW.resultHash
        AND run.sourceInputCount = (SELECT COUNT(*) FROM ${ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE} input WHERE input.runId = run.id)
        AND run.candidateCount = (SELECT COUNT(*) FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} candidate WHERE candidate.runId = run.id)
        AND run.checkCount = (SELECT COUNT(*) FROM ${ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE} checkRow WHERE checkRow.runId = run.id)
        AND run.reconciliationCount = (SELECT COUNT(*) FROM ${ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE} reconciliation WHERE reconciliation.runId = run.id)
        AND run.diagnosticCount = (SELECT COUNT(*) FROM ${ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE} diagnostic WHERE diagnostic.runId = run.id)
        AND run.eligibleCandidateCount = (SELECT COUNT(*) FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} candidate WHERE candidate.runId = run.id AND candidate.status = 'eligible_candidate')
        AND run.blockedCandidateCount = (SELECT COUNT(*) FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} candidate WHERE candidate.runId = run.id AND candidate.status = 'blocked')
        AND run.runNetMinor = ifnull((SELECT SUM(sourceNetMinor) FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} candidate WHERE candidate.runId = run.id), 0)
        AND run.runVatMinor = ifnull((SELECT SUM(sourceVatMinor) FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} candidate WHERE candidate.runId = run.id), 0)
        AND run.runGrossMinor = ifnull((SELECT SUM(sourceGrossMinor) FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} candidate WHERE candidate.runId = run.id), 0)
        AND run.eligibleCandidateNetMinor = ifnull((SELECT SUM(sourceNetMinor) FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} candidate WHERE candidate.runId = run.id AND candidate.status = 'eligible_candidate'), 0)
        AND run.eligibleCandidateVatMinor = ifnull((SELECT SUM(sourceVatMinor) FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} candidate WHERE candidate.runId = run.id AND candidate.status = 'eligible_candidate'), 0)
        AND run.eligibleCandidateGrossMinor = ifnull((SELECT SUM(sourceGrossMinor) FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} candidate WHERE candidate.runId = run.id AND candidate.status = 'eligible_candidate'), 0)
        AND audit.inputCount = run.sourceInputCount
        AND audit.candidateCount = run.candidateCount
        AND audit.checkCount = run.checkCount
        AND audit.reconciliationCount = run.reconciliationCount
        AND audit.diagnosticCount = run.diagnosticCount
    )
    BEGIN
      SELECT RAISE(ABORT, 'actual source dry run finalization mismatch');
    END;
  `;
}

function expectedTriggerDefinitions() {
  const definitions = {};
  for (const table of ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES) {
    definitions[`trg_${table}_no_update`] = immutableUpdateTriggerSql(table);
    definitions[`trg_${table}_no_delete`] = immutableDeleteTriggerSql(table);
  }
  definitions.trg_actual_source_dry_run_operations_no_replace = noReplaceTriggerSql(
    'trg_actual_source_dry_run_operations_no_replace',
    ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE,
    'actual source dry run operations are append-only',
  );
  definitions.trg_actual_source_dry_run_audit_events_no_replace = noReplaceTriggerSql(
    'trg_actual_source_dry_run_audit_events_no_replace',
    ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE,
    'actual source dry run audit events are append-only',
  );
  definitions.trg_actual_source_input_before_seal = beforeSealTriggerSql(
    'trg_actual_source_input_before_seal',
    ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE,
    'runId',
  );
  definitions.trg_actual_source_candidate_before_seal = beforeSealTriggerSql(
    'trg_actual_source_candidate_before_seal',
    ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE,
    'runId',
  );
  definitions.trg_actual_source_check_before_seal = beforeSealTriggerSql(
    'trg_actual_source_check_before_seal',
    ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE,
    'runId',
  );
  definitions.trg_actual_source_reconciliation_before_seal = beforeSealTriggerSql(
    'trg_actual_source_reconciliation_before_seal',
    ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE,
    'runId',
  );
  definitions.trg_actual_source_diagnostic_before_seal = beforeSealTriggerSql(
    'trg_actual_source_diagnostic_before_seal',
    ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE,
    'runId',
  );
  definitions.trg_actual_source_audit_before_seal = auditBeforeSealTriggerSql();
  definitions.trg_actual_source_operation_finalize_run = operationFinalizeTriggerSql();
  return definitions;
}

function ensureActualSourceEligibilityDryRunSchema(db) {
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
  assertNoCompetingRoots(db);
  assertPlatformIdentityStructure(db);
  assertBillingSourceAuthorityStructure(db);
  assertForecastReceivablesPlanningStructure(db);
  assertCapabilityCatalogExact(db);
  assertForeignKeyCheckClean(db);

  const applied = migrationRow(db, ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID);
  if (applied) {
    if (Number(applied.version) !== ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_SCHEMA_VERSION) {
      throw new Error(`ACTUAL_SOURCE_PR8_MIGRATION_VERSION_MISMATCH:${applied.version}`);
    }
    assertActualSourceEligibilityDryRunStructure(db);
    return false;
  }
  if (hasUnexpectedPartialState(db)) throw new Error('ACTUAL_SOURCE_PR8_UNEXPECTED_PARTIAL_STATE');
  assertNoCanonicalFinancialRows(db);

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE ${ACTUAL_SOURCE_DRY_RUNS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        companyTimezone TEXT NOT NULL,
        asOfDate TEXT NOT NULL,
        evaluatorVersion TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        policyManifestJson TEXT NOT NULL,
        policyManifestHash TEXT NOT NULL,
        sourceInputManifestJson TEXT NOT NULL,
        sourceInputManifestHash TEXT NOT NULL,
        sourceInputCount INTEGER NOT NULL,
        candidateCount INTEGER NOT NULL,
        checkCount INTEGER NOT NULL,
        reconciliationCount INTEGER NOT NULL,
        diagnosticCount INTEGER NOT NULL,
        eligibleCandidateCount INTEGER NOT NULL,
        blockedCandidateCount INTEGER NOT NULL,
        runNetMinor INTEGER NOT NULL,
        runVatMinor INTEGER NOT NULL,
        runGrossMinor INTEGER NOT NULL,
        eligibleCandidateNetMinor INTEGER NOT NULL,
        eligibleCandidateVatMinor INTEGER NOT NULL,
        eligibleCandidateGrossMinor INTEGER NOT NULL,
        resultHash TEXT NOT NULL,
        status TEXT NOT NULL,
        diagnosticOnly INTEGER NOT NULL DEFAULT 1,
        canonicalWriteAuthorized INTEGER NOT NULL DEFAULT 0,
        productionActivationAuthorized INTEGER NOT NULL DEFAULT 0,
        correlationId TEXT NOT NULL,
        operationId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        finalizedAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        UNIQUE (operationId, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (operationId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        CHECK (lower(branchId) NOT IN ('*', 'all', 'global', 'company-wide', 'company_wide', 'any', 'null')),
        CHECK (date(asOfDate) = asOfDate),
        CHECK (json_valid(policyManifestJson) AND json_type(policyManifestJson) = 'object'),
        CHECK (json_valid(sourceInputManifestJson) AND json_type(sourceInputManifestJson) = 'array'),
        CHECK (length(policyManifestHash) = 64 AND length(sourceInputManifestHash) = 64 AND length(resultHash) = 64),
        CHECK (typeof(sourceInputCount) = 'integer' AND sourceInputCount >= 0),
        CHECK (typeof(candidateCount) = 'integer' AND candidateCount >= 0),
        CHECK (typeof(checkCount) = 'integer' AND checkCount >= 0),
        CHECK (typeof(reconciliationCount) = 'integer' AND reconciliationCount >= 0),
        CHECK (typeof(diagnosticCount) = 'integer' AND diagnosticCount >= 0),
        CHECK (typeof(eligibleCandidateCount) = 'integer' AND eligibleCandidateCount >= 0),
        CHECK (typeof(blockedCandidateCount) = 'integer' AND blockedCandidateCount >= 0),
        CHECK (candidateCount = eligibleCandidateCount + blockedCandidateCount),
        CHECK (typeof(runNetMinor) = 'integer' AND runNetMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(runVatMinor) = 'integer' AND runVatMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(runGrossMinor) = 'integer' AND runGrossMinor BETWEEN 0 AND 9007199254740991),
        CHECK (runNetMinor + runVatMinor = runGrossMinor),
        CHECK (typeof(eligibleCandidateNetMinor) = 'integer' AND eligibleCandidateNetMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(eligibleCandidateVatMinor) = 'integer' AND eligibleCandidateVatMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(eligibleCandidateGrossMinor) = 'integer' AND eligibleCandidateGrossMinor BETWEEN 0 AND 9007199254740991),
        CHECK (eligibleCandidateNetMinor + eligibleCandidateVatMinor = eligibleCandidateGrossMinor),
        CHECK (status IN ('completed', 'completed_with_blockers', 'completed_no_candidates')),
        CHECK ((status = 'completed' AND candidateCount > 0 AND blockedCandidateCount = 0)
          OR (status = 'completed_with_blockers' AND (blockedCandidateCount > 0 OR diagnosticCount > 0))
          OR (status = 'completed_no_candidates' AND candidateCount = 0)),
        CHECK (diagnosticOnly = 1 AND canonicalWriteAuthorized = 0 AND productionActivationAuthorized = 0),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (finalizedAt = createdAt),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE} (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        sourceKind TEXT NOT NULL,
        sourceTableIdentity TEXT NOT NULL,
        sourceId TEXT NOT NULL,
        sourceVersion INTEGER,
        externalAssertionHash TEXT,
        normalizedInputHash TEXT NOT NULL,
        sourceState TEXT,
        deterministicOrderKey TEXT NOT NULL,
        activationBoundaryId TEXT,
        rentalLineId TEXT,
        periodId TEXT,
        closedPeriodVersionId TEXT,
        snapshotId TEXT,
        updId TEXT,
        updVersionId TEXT,
        updLineId TEXT,
        updLineVersionId TEXT,
        coverageSetId TEXT,
        coverageSliceId TEXT,
        sourceOperationId TEXT,
        relationshipJson TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (runId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (activationBoundaryId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (sourceTableIdentity = sourceKind),
        CHECK (length(trim(sourceId)) > 0),
        CHECK (sourceVersion IS NULL OR (typeof(sourceVersion) = 'integer' AND sourceVersion >= 1)),
        CHECK (externalAssertionHash IS NULL OR length(externalAssertionHash) = 64),
        CHECK (length(normalizedInputHash) = 64 AND length(deterministicOrderKey) = 64),
        CHECK (json_valid(relationshipJson) AND json_type(relationshipJson) = 'object'),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        candidateKey TEXT NOT NULL,
        activationBoundaryId TEXT NOT NULL,
        rentalLineId TEXT NOT NULL,
        rentalId TEXT NOT NULL,
        clientId TEXT NOT NULL,
        contractId TEXT,
        periodId TEXT NOT NULL,
        closedPeriodVersionId TEXT NOT NULL,
        snapshotId TEXT NOT NULL,
        updId TEXT NOT NULL,
        formedUpdVersionId TEXT NOT NULL,
        currentConductedUpdVersionId TEXT,
        updLineId TEXT NOT NULL,
        updLineVersionId TEXT NOT NULL,
        coverageSetId TEXT NOT NULL,
        coverageSliceId TEXT NOT NULL,
        sliceStartDate TEXT NOT NULL,
        sliceEndDateExclusive TEXT NOT NULL,
        sourceNetMinor INTEGER NOT NULL,
        sourceVatMinor INTEGER NOT NULL,
        sourceGrossMinor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        contractualDueDate TEXT,
        dueDateProvenance TEXT NOT NULL,
        dueDateEvidenceRef TEXT,
        proposedOriginalAmountMinor INTEGER,
        status TEXT NOT NULL,
        blockerCodesJson TEXT NOT NULL,
        policyManifestHash TEXT NOT NULL,
        inputLineageHash TEXT NOT NULL,
        resultHash TEXT NOT NULL,
        diagnosticOnly INTEGER NOT NULL DEFAULT 1,
        canonicalWriteAuthorized INTEGER NOT NULL DEFAULT 0,
        productionActivationAuthorized INTEGER NOT NULL DEFAULT 0,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, runId, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (runId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (activationBoundaryId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (rentalLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_RENTAL_LINES_TABLE}(id, companyId, branchId)
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
        FOREIGN KEY (updId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPDS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (formedUpdVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (currentConductedUpdVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (updLineId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_LINES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (updLineVersionId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (coverageSetId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_COVERAGE_SETS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (coverageSliceId, companyId, branchId)
          REFERENCES ${BILLING_SOURCE_COVERAGE_SLICES_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(candidateKey) = 64 AND length(policyManifestHash) = 64
          AND length(inputLineageHash) = 64 AND length(resultHash) = 64),
        CHECK (date(sliceStartDate) = sliceStartDate AND date(sliceEndDateExclusive) = sliceEndDateExclusive AND sliceStartDate < sliceEndDateExclusive),
        CHECK (typeof(sourceNetMinor) = 'integer' AND sourceNetMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(sourceVatMinor) = 'integer' AND sourceVatMinor BETWEEN 0 AND 9007199254740991),
        CHECK (typeof(sourceGrossMinor) = 'integer' AND sourceGrossMinor BETWEEN 0 AND 9007199254740991),
        CHECK (sourceNetMinor + sourceVatMinor = sourceGrossMinor),
        CHECK (currency = 'RUB'),
        CHECK (dueDateProvenance IN ('invoice_due_date', 'contractual_payment_due_date', 'installment_due_date', 'unknown')),
        CHECK ((dueDateProvenance = 'unknown' AND contractualDueDate IS NULL AND dueDateEvidenceRef IS NULL)
          OR (dueDateProvenance != 'unknown' AND date(contractualDueDate) = contractualDueDate AND length(trim(dueDateEvidenceRef)) > 0)),
        CHECK (proposedOriginalAmountMinor IS NULL OR (typeof(proposedOriginalAmountMinor) = 'integer' AND proposedOriginalAmountMinor BETWEEN 0 AND 9007199254740991)),
        CHECK (status IN ('eligible_candidate', 'blocked')),
        CHECK (json_valid(blockerCodesJson) AND json_type(blockerCodesJson) = 'array'),
        CHECK ((status = 'eligible_candidate' AND json_array_length(blockerCodesJson) = 0 AND sourceGrossMinor > 0 AND currentConductedUpdVersionId IS NOT NULL AND proposedOriginalAmountMinor IS NOT NULL)
          OR (status = 'blocked' AND json_array_length(blockerCodesJson) > 0)),
        CHECK (diagnosticOnly = 1 AND canonicalWriteAuthorized = 0 AND productionActivationAuthorized = 0),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE} (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        candidateId TEXT,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        gateCode TEXT NOT NULL,
        outcome TEXT NOT NULL,
        policyDecisionRef TEXT,
        policyDecisionVersion INTEGER,
        policyDecisionHash TEXT,
        sourceEvidenceRefsJson TEXT NOT NULL,
        expectedFingerprint TEXT,
        observedFingerprint TEXT,
        reasonCode TEXT,
        checkHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (runId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (candidateId, runId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE}(id, runId, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (candidateId IS NULL OR length(trim(candidateId)) > 0),
        CHECK (outcome IN ('passed', 'blocked', 'not_applicable')),
        CHECK (policyDecisionVersion IS NULL OR (typeof(policyDecisionVersion) = 'integer' AND policyDecisionVersion >= 1)),
        CHECK (policyDecisionHash IS NULL OR length(policyDecisionHash) = 64),
        CHECK (json_valid(sourceEvidenceRefsJson) AND json_type(sourceEvidenceRefsJson) = 'array'),
        CHECK (expectedFingerprint IS NULL OR length(expectedFingerprint) = 64),
        CHECK (observedFingerprint IS NULL OR length(observedFingerprint) = 64),
        CHECK ((outcome = 'blocked' AND length(trim(reasonCode)) > 0) OR outcome != 'blocked'),
        CHECK (length(checkHash) = 64),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE} (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        candidateId TEXT,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        dimensionKind TEXT NOT NULL,
        dimensionIdsJson TEXT NOT NULL,
        expectedNetMinor INTEGER NOT NULL,
        expectedVatMinor INTEGER NOT NULL,
        expectedGrossMinor INTEGER NOT NULL,
        observedNetMinor INTEGER NOT NULL,
        observedVatMinor INTEGER NOT NULL,
        observedGrossMinor INTEGER NOT NULL,
        deltaNetMinor INTEGER NOT NULL,
        deltaVatMinor INTEGER NOT NULL,
        deltaGrossMinor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        reconciliationRuleVersion TEXT NOT NULL,
        sourceInputHash TEXT NOT NULL,
        blockerState INTEGER NOT NULL,
        reconciliationHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (runId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (candidateId, runId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE}(id, runId, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (candidateId IS NULL OR length(trim(candidateId)) > 0),
        CHECK (dimensionKind IN ('snapshot_equation', 'upd_line_equation', 'coverage_slice_equation', 'upd_line_aggregate', 'closed_period_snapshot_aggregate', 'coverage_set_delta')),
        CHECK (json_valid(dimensionIdsJson) AND json_type(dimensionIdsJson) = 'object'),
        CHECK (typeof(expectedNetMinor) = 'integer' AND typeof(expectedVatMinor) = 'integer' AND typeof(expectedGrossMinor) = 'integer'),
        CHECK (typeof(observedNetMinor) = 'integer' AND typeof(observedVatMinor) = 'integer' AND typeof(observedGrossMinor) = 'integer'),
        CHECK (typeof(deltaNetMinor) = 'integer' AND typeof(deltaVatMinor) = 'integer' AND typeof(deltaGrossMinor) = 'integer'),
        CHECK (currency = 'RUB'),
        CHECK (length(sourceInputHash) = 64 AND length(reconciliationHash) = 64),
        CHECK (blockerState IN (0, 1)),
        CHECK ((blockerState = 0 AND deltaNetMinor = 0 AND deltaVatMinor = 0 AND deltaGrossMinor = 0) OR blockerState = 1),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE} (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        candidateId TEXT,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        severity TEXT NOT NULL,
        code TEXT NOT NULL,
        sourceKind TEXT,
        sourceId TEXT,
        sourceVersion INTEGER,
        affectedStartDate TEXT,
        affectedEndDateExclusive TEXT,
        expectedEvidenceJson TEXT NOT NULL,
        observedEvidenceJson TEXT NOT NULL,
        policyReferencesJson TEXT NOT NULL,
        detectedAt TEXT NOT NULL,
        detectorVersion TEXT NOT NULL,
        diagnosticHash TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (runId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (candidateId, runId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE}(id, runId, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (candidateId IS NULL OR length(trim(candidateId)) > 0),
        CHECK (severity IN ('blocking', 'info')),
        CHECK (length(trim(code)) > 0),
        CHECK (sourceVersion IS NULL OR (typeof(sourceVersion) = 'integer' AND sourceVersion >= 1)),
        CHECK ((affectedStartDate IS NULL AND affectedEndDateExclusive IS NULL)
          OR (date(affectedStartDate) = affectedStartDate AND date(affectedEndDateExclusive) = affectedEndDateExclusive AND affectedStartDate < affectedEndDateExclusive)),
        CHECK (json_valid(expectedEvidenceJson) AND json_valid(observedEvidenceJson) AND json_valid(policyReferencesJson)),
        CHECK (detectedAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (length(diagnosticHash) = 64),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        operationType TEXT NOT NULL,
        idempotencyKey TEXT NOT NULL,
        commandFingerprint TEXT NOT NULL,
        policyManifestHash TEXT NOT NULL,
        inputSetHash TEXT NOT NULL,
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
          REFERENCES ${ACTUAL_SOURCE_DRY_RUNS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (auditEventId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        CHECK (operationType = 'evaluate_actual_source_dry_run'),
        CHECK (capabilityKey = 'receivables.read'),
        CHECK (length(commandFingerprint) = 64 AND length(policyManifestHash) = 64
          AND length(inputSetHash) = 64 AND length(resultHash) = 64),
        CHECK (typeof(actorMembershipVersion) = 'integer' AND actorMembershipVersion >= 1),
        CHECK (typeof(roleTemplateVersion) = 'integer' AND roleTemplateVersion >= 1),
        CHECK (typeof(capabilityCatalogVersion) = 'integer' AND capabilityCatalogVersion = 1),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      CREATE TABLE ${ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE} (
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
        inputCount INTEGER NOT NULL,
        candidateCount INTEGER NOT NULL,
        checkCount INTEGER NOT NULL,
        reconciliationCount INTEGER NOT NULL,
        diagnosticCount INTEGER NOT NULL,
        operationId TEXT NOT NULL,
        schemaVersion INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE (id, companyId, branchId),
        ${scopedRootForeignKeys()},
        FOREIGN KEY (operationId, companyId, branchId)
          REFERENCES ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE}(id, companyId, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (actorMembershipId, companyId)
          REFERENCES company_memberships(id, companyId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (capabilityCatalogVersion, capabilityKey)
          REFERENCES capability_catalog_entries(catalogVersion, capabilityKey)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (aggregateType = 'actual_source_dry_run' AND aggregateVersion = 1),
        CHECK (eventType = 'actual_source_dry_run_evaluated' AND actorType = 'user'),
        CHECK (capabilityKey = 'receivables.read'),
        CHECK (beforeFingerprint IS NULL OR length(beforeFingerprint) = 64),
        CHECK (length(afterFingerprint) = 64 AND length(inputSetHash) = 64 AND length(resultHash) = 64),
        CHECK (typeof(inputCount) = 'integer' AND inputCount >= 0),
        CHECK (typeof(candidateCount) = 'integer' AND candidateCount >= 0),
        CHECK (typeof(checkCount) = 'integer' AND checkCount >= 0),
        CHECK (typeof(reconciliationCount) = 'integer' AND reconciliationCount >= 0),
        CHECK (typeof(diagnosticCount) = 'integer' AND diagnosticCount >= 0),
        CHECK (createdAt GLOB '????-??-??T??:??:??.???Z'),
        CHECK (schemaVersion = 1)
      );

      ${Object.values(EXPECTED_INDEX_DEFINITIONS).join('\n')}

      ${ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES.map(immutableTriggersSql).join('\n')}

      ${noReplaceTriggerSql(
    'trg_actual_source_dry_run_operations_no_replace',
    ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE,
    'actual source dry run operations are append-only',
  )}
      ${noReplaceTriggerSql(
    'trg_actual_source_dry_run_audit_events_no_replace',
    ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE,
    'actual source dry run audit events are append-only',
  )}

      ${beforeSealTriggerSql('trg_actual_source_input_before_seal', ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE, 'runId')}
      ${beforeSealTriggerSql('trg_actual_source_candidate_before_seal', ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE, 'runId')}
      ${beforeSealTriggerSql('trg_actual_source_check_before_seal', ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE, 'runId')}
      ${beforeSealTriggerSql('trg_actual_source_reconciliation_before_seal', ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE, 'runId')}
      ${beforeSealTriggerSql('trg_actual_source_diagnostic_before_seal', ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE, 'runId')}

      ${auditBeforeSealTriggerSql()}
      ${operationFinalizeTriggerSql()}
    `);

    assertActualSourceEligibilityDryRunStructure(db, { requireMigration: false });
    db.prepare(`
      INSERT INTO sql_shadow_schema_migrations (name, version) VALUES (?, ?)
    `).run(
      ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID,
      ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_SCHEMA_VERSION,
    );
    return true;
  });

  return migrate.immediate();
}

module.exports = {
  ACTUAL_SOURCE_DRY_RUNS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE,
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_MIGRATION_ID,
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_SCHEMA_VERSION,
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES,
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
  REQUIRED_TRIGGERS,
  assertActualSourceEligibilityDryRunStructure,
  ensureActualSourceEligibilityDryRunSchema,
};
