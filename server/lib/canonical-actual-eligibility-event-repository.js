const { randomUUID } = require('node:crypto');
const {
  CANONICAL_COMPANIES_TABLE,
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
} = require('./canonical-receivables-schema');
const {
  BILLING_SOURCE_AUTHORITY_TABLES,
  BILLING_SOURCE_COVERAGE_SETS_TABLE,
  BILLING_SOURCE_COVERAGE_SLICES_TABLE,
  BILLING_SOURCE_COVERAGE_SUPERSESSIONS_TABLE,
  BILLING_SOURCE_PERIODS_TABLE,
  BILLING_SOURCE_PERIOD_VERSIONS_TABLE,
  BILLING_SOURCE_SNAPSHOTS_TABLE,
  BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE,
  BILLING_SOURCE_UPD_VERSIONS_TABLE,
} = require('./billing-source-authority-schema');
const {
  ACTUAL_SOURCE_DRY_RUNS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE,
  REQUIRED_COLUMNS: PR8_REQUIRED_COLUMNS,
} = require('./actual-source-eligibility-dry-run-schema');
const {
  fingerprint: pr8Fingerprint,
  safeAdd: pr8SafeAdd,
  stableJson: pr8StableJson,
} = require('./actual-source-eligibility-dry-run-domain');
const {
  ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
  CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
  CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
  GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE,
  REQUIRED_COLUMNS,
  assertCanonicalActualPostingStructure,
} = require('./canonical-actual-posting-schema');
const {
  ERROR_CODES,
  OPERATION_DOMAIN,
  CanonicalActualPostingError,
  DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
  assertCanonicalActualPostingRuntimeContract,
  assertExactObjectKeys,
  assertGovernedAuthorityRecord,
  assertHash,
  assertIdentifier,
  assertRfc3339Milliseconds,
  assertSafeInteger,
  assertUuidV4,
  attemptAccountingResult,
  buildConflictContracts,
  canonicalJson,
  circuitTransitionResult,
  compareOperationalOrder,
  compareSafeIntegerAscending,
  compareUtf16Ascending,
  computeAcceptedDryRunsHash,
  computeAcceptedPr8EvidenceHash,
  computeArtifactIdentityHash,
  computeConflictHash,
  computeCoverageLineageRootId,
  computeDueDatePolicySetHash,
  computeEconomicLineageCandidateFingerprint,
  computeEconomicLineageKey,
  computeEconomicSourceRevisionKey,
  computeEligibleEventHash,
  computeSourceLineageHash,
  computeUnknownDueDateMappingHash,
  createFrozenAuthorityChainSnapshot,
  createPendingConflictTransition,
  deriveRepositoryIdentity,
  fail,
  mapSqliteError,
  materializeInert,
  parseCanonicalJson,
  parseUtcMilliseconds,
  rateAccountingResult,
  renderUtcMilliseconds,
  selectRateQualifyingAttempts,
  sha256Canonical,
  validateEligibleEventRecord,
  verifyConflictTransition,
  verifyFrozenAuthorityChainSnapshot,
} = require('./canonical-actual-posting-domain');
const {
  createCanonicalActualPostingAuthorityRepository,
  selectGlobalAuthorityDenial,
} = require('./canonical-actual-posting-authority-repository');

const denialAttemptUuidV4 = randomUUID;
const repositoryClockReadUtcMilliseconds = Date.now.bind(Date);

const frozenDenialPackages = new WeakSet();
const frozenDenialSelectors = new WeakMap();

const NON_AUTHORITY_RECONSTRUCTION_REGISTRY = Object.freeze({
  AUTHORIZATION_DRIFT: 'accepted_context',
  ACTIVATION_DRIFT: 'accepted_context',
  SOURCE_LINEAGE_ROOT_CONFLICT: 'source_lineage',
  SOURCE_LINEAGE_BROKEN_SUCCESSOR: 'source_lineage',
  SOURCE_LINEAGE_NO_CURRENT_REVISION: 'source_lineage',
  SOURCE_LINEAGE_MULTIPLE_CURRENT_REVISIONS: 'source_lineage',
  SOURCE_CORRECTION_AFTER_POSTING: 'event_graph',
  SOURCE_CORRECTION_AFTER_ELIGIBILITY: 'event_graph',
  SOURCE_REVISION_CHANGED_BEFORE_POSTING: 'event_graph',
  PR6_LINEAGE_DRIFT: 'event_graph',
  PR8_EVIDENCE_MISMATCH: 'accepted_context',
  DUE_DATE_POLICY_DRIFT: 'accepted_context',
  COMPANY_TIMEZONE_DRIFT: 'accepted_context',
  IDEMPOTENCY_CONTENT_CONFLICT: 'posting_graph',
  AUDIT_SEAL_MISMATCH: 'posting_graph',
  ECONOMIC_SOURCE_EVENT_MISMATCH: 'event_graph',
});

function freezeDenialPackageForRepository({
  conflictCandidateProjection,
  conflictType,
  denialAttemptId,
  deniedAttemptedAt,
  expectedProjection,
  observedProjection,
  sourceAuthorityChainSnapshot,
  producerAuthorityChainSnapshot,
  postingAuthorityChainSnapshot,
  reconstructionSelectors,
}) {
  const contracts = buildConflictContracts({
    conflictType,
    denialAttemptId,
    deniedAttemptedAt,
    expectedProjection,
    observedProjection,
  });
  const sourceSnapshot = materializeInert(sourceAuthorityChainSnapshot.snapshot, 'sourceAuthorityChainSnapshot');
  const producerSnapshot = materializeInert(producerAuthorityChainSnapshot.snapshot, 'producerAuthorityChainSnapshot');
  const postingSnapshot = materializeInert(postingAuthorityChainSnapshot.snapshot, 'postingAuthorityChainSnapshot');
  const candidate = materializeInert(conflictCandidateProjection, 'conflictCandidateProjection');
  if (
    candidate.conflictType !== conflictType
    || candidate.denialAttemptId !== denialAttemptId
    || candidate.deniedAttemptedAt !== deniedAttemptedAt
    || candidate.expectedFingerprint !== contracts.expectedFingerprint
    || candidate.observedFingerprint !== contracts.observedFingerprint
    || candidate.conflictObservationHash !== contracts.conflictObservationHash
    || candidate.sourceAuthorityChainSnapshotHash !== sourceAuthorityChainSnapshot.hash
    || candidate.producerAuthorityChainSnapshotHash !== producerAuthorityChainSnapshot.hash
    || candidate.postingAuthorityChainSnapshotHash !== postingAuthorityChainSnapshot.hash
  ) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
  const conflictHashCandidate = computeConflictHash(candidate);
  const packageValue = Object.freeze({
    conflictCandidateProjection: candidate,
    conflictHashCandidate,
    conflictObservationHash: contracts.conflictObservationHash,
    conflictType,
    denialAttemptId,
    deniedAttemptedAt,
    expectedFingerprint: contracts.expectedFingerprint,
    expectedProjection: materializeInert(expectedProjection),
    observedFingerprint: contracts.observedFingerprint,
    observedProjection: materializeInert(observedProjection),
    postingAuthorityChainSnapshot: postingSnapshot,
    postingAuthorityChainSnapshotHash: postingAuthorityChainSnapshot.hash,
    producerAuthorityChainSnapshot: producerSnapshot,
    producerAuthorityChainSnapshotHash: producerAuthorityChainSnapshot.hash,
    sourceAuthorityChainSnapshot: sourceSnapshot,
    sourceAuthorityChainSnapshotHash: sourceAuthorityChainSnapshot.hash,
  });
  frozenDenialPackages.add(packageValue);
  frozenDenialSelectors.set(
    packageValue,
    Object.freeze(materializeInert(reconstructionSelectors, 'reconstructionSelectors')),
  );
  return packageValue;
}

function assertFrozenDenialPackage(packageValue) {
  if (!frozenDenialPackages.has(packageValue)) {
    throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
  }
  return packageValue;
}

const ELIGIBILITY_COMMAND_KEYS = Object.freeze([
  'activationRecordId',
  'branchId',
  'candidateId',
  'companyId',
  'dryRunId',
  'writeAuthorizationRecordId',
]);

function repositoryError(code, message = code) {
  return new CanonicalActualPostingError(code, message);
}

function normalizeEventRow(row) {
  if (!row) return row;
  const result = { ...row };
  for (const field of [
    'eventVersion', 'netAmountMinor', 'vatAmountMinor', 'grossAmountMinor',
    'originalAmountMinor', 'selectedDueDatePolicyVersion',
    'unknownDueDateTreatmentMappingVersion', 'sourceAdapterAuthorityVersion',
    'producerAuthorityVersion', 'schemaVersion',
  ]) {
    if (result[field] !== null && result[field] !== undefined) result[field] = Number(result[field]);
  }
  return result;
}

function normalizeConflictRow(row) {
  if (!row) return row;
  const result = { ...row };
  for (const field of [
    'sourceAdapterAuthorityVersion', 'producerAuthorityVersion',
    'postingAdapterAuthorityVersion', 'deniedAuthorityVersion', 'schemaVersion',
  ]) {
    if (result[field] !== null && result[field] !== undefined) result[field] = Number(result[field]);
  }
  return result;
}

function normalizeTransitionRow(row) {
  if (!row) return row;
  const result = { ...row };
  for (const field of [
    'scopeSequence', 'attemptApplied', 'rateApplied', 'circuitApplied', 'schemaVersion',
  ]) result[field] = Number(result[field]);
  return result;
}

function readRepositoryClock() {
  let value;
  try {
    value = repositoryClockReadUtcMilliseconds();
  } catch {
    throw repositoryError('CANONICAL_REPOSITORY_CLOCK_FAILED');
  }
  try {
    return Object.freeze({ milliseconds: value, timestamp: renderUtcMilliseconds(value) });
  } catch {
    throw repositoryError('CANONICAL_REPOSITORY_CLOCK_FAILED');
  }
}

function generateDenialAttemptId() {
  let value;
  try {
    value = denialAttemptUuidV4({ disableEntropyCache: true });
    assertUuidV4(value, 'denialAttemptId');
  } catch {
    throw repositoryError(ERROR_CODES.DENIAL_ATTEMPT_ID_GENERATION_FAILED);
  }
  return value;
}

function deriveRepositoryId(domain, input) {
  return deriveRepositoryIdentity(domain, input);
}

function insertExact(db, table, row, columns = Object.keys(row)) {
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(...columns.map(column => row[column]));
}

function beginImmediate(db) {
  db.exec('BEGIN IMMEDIATE');
}

function rollbackQuietly(db) {
  if (db.inTransaction) db.exec('ROLLBACK');
}

function mapAndThrow(error) {
  if (error instanceof CanonicalActualPostingError) throw error;
  const mapped = mapSqliteError(error);
  if (mapped !== error) throw mapped;
  throw error;
}

function assertEligibilityCommand(command) {
  const inert = materializeInert(command, 'command');
  assertExactObjectKeys(inert, ELIGIBILITY_COMMAND_KEYS, 'command');
  for (const key of ELIGIBILITY_COMMAND_KEYS) assertIdentifier(inert[key], key);
  return inert;
}

function exactRowsEqual(left, right, excluded = []) {
  const skip = new Set(excluded);
  const leftProjection = {};
  const rightProjection = {};
  for (const key of Object.keys(left)) if (!skip.has(key)) leftProjection[key] = left[key];
  for (const key of Object.keys(right)) if (!skip.has(key)) rightProjection[key] = right[key];
  return canonicalJson(leftProjection) === canonicalJson(rightProjection);
}

function operationalRows(db) {
  return db.prepare(`
    SELECT
      transition.transitionId,
      transition.companyId,
      transition.branchId,
      transition.operationDomain,
      transition.scopeSequence,
      transition.rateApplied,
      transition.circuitApplied,
      transition.conflictType,
      transition.denialAttemptId,
      conflict.evidenceAttemptedAt
    FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE} AS transition
    JOIN ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE} AS conflict
      ON conflict.id = transition.conflictId
     AND conflict.companyId = transition.companyId
     AND conflict.branchId = transition.branchId
     AND conflict.denialAttemptId = transition.denialAttemptId
     AND conflict.conflictHash = transition.conflictHash
  `).all().map(normalizeTransitionRow);
}

function persistedRowVersion(row) {
  for (const field of ['version', 'sourceVersion', 'sourceEventVersion', 'resultVersion', 'aggregateVersion']) {
    if (row[field] === null || row[field] === undefined) continue;
    const value = Number(row[field]);
    if (Number.isSafeInteger(value) && value >= 1) return value;
  }
  return null;
}

function persistedRowFingerprint(db, tableName, row) {
  const columns = db.prepare(`PRAGMA table_xinfo(${tableName})`).all()
    .filter(column => Number(column.hidden) === 0)
    .sort((left, right) => compareSafeIntegerAscending(Number(left.cid), Number(right.cid)))
    .map(column => {
      let value = row[column.name];
      if (
        value !== null
        && typeof value !== 'string'
        && !(typeof value === 'number' && Number.isSafeInteger(value))
      ) {
        if (
          tableName !== BILLING_SOURCE_PERIOD_VERSIONS_TABLE
          || column.name !== 'version'
          || typeof value !== 'number'
          || !Number.isFinite(value)
        ) throw repositoryError('CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID');
        value = Object.freeze({
          domain: 'rentcore.billing_source_authority.invalid_semantic_version',
          numericRepresentation: String(value),
          storageType: 'real',
          version: 1,
        });
      }
      return { columnName: column.name, value };
    });
  const rowVersion = persistedRowVersion(row);
  return {
    rowFingerprint: sha256Canonical({
      columns,
      domain: 'rentcore.billing_source_authority.persisted_row',
      rowId: row.id,
      rowVersion,
      tableName,
      version: 1,
    }),
    rowId: row.id,
    rowVersion,
    tableName,
  };
}

function sameScopeLogicalCoverageRows(db, candidate) {
  return db.prepare(`
    SELECT slice.*, coverage.updId AS graphUpdId, coverage.formedUpdVersionId AS graphFormedUpdVersionId,
           coverage.status AS graphCoverageStatus
    FROM ${BILLING_SOURCE_COVERAGE_SLICES_TABLE} AS slice
    JOIN ${BILLING_SOURCE_COVERAGE_SETS_TABLE} AS coverage
      ON coverage.id = slice.coverageSetId
     AND coverage.companyId = slice.companyId
     AND coverage.branchId = slice.branchId
    WHERE slice.companyId = ? AND slice.branchId = ?
      AND slice.rentalId = ? AND slice.rentalLineId = ? AND slice.periodId = ?
      AND slice.currency = ? AND slice.contractId IS ?
      AND slice.sliceStartDate < ? AND ? < slice.sliceEndDateExclusive
      AND coverage.status = 'validated'
    ORDER BY slice.coverageSetId ASC, slice.id ASC
  `).all(
    candidate.companyId,
    candidate.branchId,
    candidate.rentalId,
    candidate.rentalLineId,
    candidate.periodId,
    candidate.currency,
    candidate.contractId,
    candidate.sliceEndDateExclusive,
    candidate.sliceStartDate,
  );
}

const NON_LINEAGE_ID_COLUMNS = new Set([
  'actorMembershipId',
  'actorPrincipalId',
  'branchId',
  'clientId',
  'companyId',
  'contractId',
  'principalId',
  'rentalId',
]);

function isPr6LineageReferenceColumn(column) {
  return (column === 'id' || column.endsWith('Id')) && !NON_LINEAGE_ID_COLUMNS.has(column);
}

function reconstructPr6LineageRows(db, candidate) {
  const all = [];
  for (const tableName of BILLING_SOURCE_AUTHORITY_TABLES) {
    const columns = db.prepare(`PRAGMA table_xinfo(${tableName})`).all().map(column => column.name);
    const rows = db.prepare(`SELECT * FROM ${tableName} WHERE companyId = ? AND branchId = ?`)
      .all(candidate.companyId, candidate.branchId);
    for (const row of rows) all.push({ tableName, columns, row });
  }
  const known = new Set([
    candidate.activationBoundaryId,
    candidate.rentalLineId,
    candidate.periodId,
    candidate.closedPeriodVersionId,
    candidate.snapshotId,
    candidate.updId,
    candidate.formedUpdVersionId,
    candidate.currentConductedUpdVersionId,
    candidate.updLineId,
    candidate.updLineVersionId,
    candidate.coverageSetId,
    candidate.coverageSliceId,
  ].filter(Boolean));
  for (const row of sameScopeLogicalCoverageRows(db, candidate)) {
    for (const value of [
      row.id,
      row.coverageSetId,
      row.updId,
      row.graphUpdId,
      row.formedUpdVersionId,
      row.graphFormedUpdVersionId,
      row.updLineId,
      row.updLineVersionId,
      row.periodId,
      row.closedPeriodVersionId,
      row.snapshotId,
      row.rentalLineId,
    ]) if (typeof value === 'string' && value.length > 0) known.add(value);
  }
  const selected = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < all.length; index += 1) {
      if (selected.has(index)) continue;
      const entry = all[index];
      const related = entry.columns.some(column => (
        isPr6LineageReferenceColumn(column)
        && typeof entry.row[column] === 'string'
        && known.has(entry.row[column])
      ));
      if (!related) continue;
      selected.add(index);
      changed = true;
      for (const column of entry.columns) {
        if (
          isPr6LineageReferenceColumn(column)
          && typeof entry.row[column] === 'string'
          && entry.row[column]
        ) known.add(entry.row[column]);
      }
    }
  }
  const result = [...selected].map(index => {
    const entry = all[index];
    return persistedRowFingerprint(db, entry.tableName, entry.row);
  }).sort((left, right) => {
    let result = compareUtf16Ascending(left.tableName, right.tableName);
    if (result !== 0) return result;
    result = compareUtf16Ascending(left.rowId, right.rowId);
    if (result !== 0) return result;
    if (left.rowVersion === null && right.rowVersion !== null) return -1;
    if (left.rowVersion !== null && right.rowVersion === null) return 1;
    if (left.rowVersion === null && right.rowVersion === null) return 0;
    return compareSafeIntegerAscending(left.rowVersion, right.rowVersion);
  });
  if (result.length === 0) throw repositoryError('CANONICAL_PR6_LINEAGE_EMPTY');
  return Object.freeze(result);
}

function resolveCoverageRoot(db, candidate) {
  let currentSetId = candidate.coverageSetId;
  let currentSliceId = candidate.coverageSliceId;
  const visited = new Set();
  while (true) {
    if (visited.has(currentSetId)) throw repositoryError('SOURCE_LINEAGE_ROOT_CONFLICT');
    visited.add(currentSetId);
    const predecessors = db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_COVERAGE_SUPERSESSIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND replacementCoverageSetId = ?
      ORDER BY id
    `).all(candidate.companyId, candidate.branchId, currentSetId);
    if (predecessors.length > 1) throw repositoryError('SOURCE_LINEAGE_ROOT_CONFLICT');
    if (predecessors.length === 0) break;
    const relation = predecessors[0];
    if (!['corrected', 'superseded'].includes(relation.action)) {
      throw repositoryError('SOURCE_LINEAGE_ROOT_CONFLICT');
    }
    const slices = db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_COVERAGE_SLICES_TABLE}
      WHERE companyId = ? AND branchId = ? AND coverageSetId = ?
        AND updId = ? AND rentalId = ? AND rentalLineId = ? AND periodId = ?
        AND sliceStartDate = ? AND sliceEndDateExclusive = ? AND currency = ?
        AND contractId IS ?
      ORDER BY id
    `).all(
      candidate.companyId,
      candidate.branchId,
      relation.originalCoverageSetId,
      candidate.updId,
      candidate.rentalId,
      candidate.rentalLineId,
      candidate.periodId,
      candidate.sliceStartDate,
      candidate.sliceEndDateExclusive,
      candidate.currency,
      candidate.contractId,
    );
    if (slices.length !== 1) throw repositoryError('SOURCE_LINEAGE_ROOT_CONFLICT');
    currentSetId = relation.originalCoverageSetId;
    currentSliceId = slices[0].id;
  }
  return Object.freeze({ rootCoverageSetId: currentSetId, rootCoverageSliceId: currentSliceId });
}

function reconstructReplacementRelation(db, candidate) {
  const relations = [];
  const visited = new Set();
  let currentCoverageSetId = candidate.coverageSetId;
  while (true) {
    if (visited.has(currentCoverageSetId)) throw repositoryError('SOURCE_LINEAGE_ROOT_CONFLICT');
    visited.add(currentCoverageSetId);
    const predecessors = db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_COVERAGE_SUPERSESSIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND replacementCoverageSetId = ?
      ORDER BY originalCoverageSetId ASC, replacementCoverageSetId ASC, action ASC, id ASC
    `).all(candidate.companyId, candidate.branchId, currentCoverageSetId);
    if (predecessors.length === 0) break;
    if (predecessors.length !== 1) throw repositoryError('SOURCE_LINEAGE_ROOT_CONFLICT');
    const row = predecessors[0];
    if (!['corrected', 'superseded'].includes(row.action)) {
      throw repositoryError('SOURCE_LINEAGE_BROKEN_SUCCESSOR');
    }
    const fingerprint = persistedRowFingerprint(
      db,
      BILLING_SOURCE_COVERAGE_SUPERSESSIONS_TABLE,
      row,
    ).rowFingerprint;
    relations.push({
      action: row.action,
      predecessorCoverageSetId: row.originalCoverageSetId,
      replacementCoverageSetId: row.replacementCoverageSetId,
      supersessionRowHash: fingerprint,
    });
    currentCoverageSetId = row.originalCoverageSetId;
  }
  relations.sort((left, right) => {
    let result = compareUtf16Ascending(left.predecessorCoverageSetId, right.predecessorCoverageSetId);
    if (result !== 0) return result;
    result = compareUtf16Ascending(left.replacementCoverageSetId, right.replacementCoverageSetId);
    if (result !== 0) return result;
    return compareUtf16Ascending(left.action, right.action);
  });
  return Object.freeze({
    relations: Object.freeze(relations.map(relation => Object.freeze(relation))),
    replacementRelationHash: sha256Canonical({
      domain: 'rentcore.canonical_actual_posting.replacement_relation',
      economicLineageCandidateFingerprint: computeEconomicLineageCandidateFingerprint({
        branchId: candidate.branchId,
        companyId: candidate.companyId,
        contractId: candidate.contractId ?? null,
        coverageEndExclusive: candidate.sliceEndDateExclusive,
        coverageStart: candidate.sliceStartDate,
        currency: candidate.currency,
        rentalId: candidate.rentalId,
        rentalLineId: candidate.rentalLineId,
      }),
      relations,
      version: 1,
    }),
  });
}

function sourceCandidateFingerprint(candidate) {
  return computeEconomicLineageCandidateFingerprint({
    branchId: candidate.branchId,
    companyId: candidate.companyId,
    contractId: candidate.contractId ?? null,
    coverageEndExclusive: candidate.sliceEndDateExclusive,
    coverageStart: candidate.sliceStartDate,
    currency: candidate.currency,
    rentalId: candidate.rentalId,
    rentalLineId: candidate.rentalLineId,
  });
}

function hasValidUniqueCurrentClosedPeriod(db, candidate) {
  const period = db.prepare(`
    SELECT * FROM ${BILLING_SOURCE_PERIODS_TABLE} WHERE id = ?
  `).get(candidate.periodId);
  if (
    !period
    || period.companyId !== candidate.companyId
    || period.branchId !== candidate.branchId
  ) return false;
  const rows = db.prepare(`
    SELECT *, typeof(version) AS semanticVersionStorageClass
    FROM ${BILLING_SOURCE_PERIOD_VERSIONS_TABLE}
    WHERE periodId = ?
    ORDER BY version ASC, id ASC
  `).all(candidate.periodId);
  if (rows.length === 0) return false;
  const ids = new Map();
  const versions = new Map();
  const successors = new Map();
  const roots = [];
  for (const row of rows) {
    const version = Number(row.version);
    if (
      row.companyId !== candidate.companyId
      || row.branchId !== candidate.branchId
      || row.periodId !== candidate.periodId
      || row.semanticVersionStorageClass !== 'integer'
      || !Number.isSafeInteger(version)
      || version < 1
      || ids.has(row.id)
      || versions.has(version)
    ) return false;
    ids.set(row.id, row);
    versions.set(version, row);
    if (row.previousVersionId === null) {
      roots.push(row);
    } else {
      const previousSuccessors = successors.get(row.previousVersionId) || [];
      previousSuccessors.push(row);
      successors.set(row.previousVersionId, previousSuccessors);
    }
  }
  if (roots.length !== 1 || roots[0].version !== 1) return false;
  for (const successorRows of successors.values()) {
    if (successorRows.length !== 1) return false;
  }

  const snapshots = db.prepare(`
    SELECT * FROM ${BILLING_SOURCE_SNAPSHOTS_TABLE} WHERE periodId = ?
  `).all(candidate.periodId);
  const snapshotsById = new Map();
  for (const snapshot of snapshots) {
    if (snapshotsById.has(snapshot.id)) return false;
    snapshotsById.set(snapshot.id, snapshot);
  }
  const closedSnapshotIds = new Set();
  let previous = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const version = Number(row.version);
    if (
      version !== index + 1
      || row.previousVersionId !== (previous?.id ?? null)
    ) return false;
    if (row.eventType === 'closed') {
      if (
        row.reopensClosedVersionId !== null
        || (index === 0 ? previous !== null : previous?.eventType !== 'reopened')
        || row.effectiveTermsVersionId === null
        || row.snapshotId === null
        || closedSnapshotIds.has(row.snapshotId)
      ) return false;
      const snapshot = snapshotsById.get(row.snapshotId);
      if (
        !snapshot
        || snapshot.companyId !== candidate.companyId
        || snapshot.branchId !== candidate.branchId
        || snapshot.periodId !== candidate.periodId
        || snapshot.closedPeriodVersionId !== row.id
        || snapshot.effectiveTermsVersionId !== row.effectiveTermsVersionId
      ) return false;
      closedSnapshotIds.add(row.snapshotId);
    } else if (
      row.eventType !== 'reopened'
      || index === 0
      || previous?.eventType !== 'closed'
      || row.reopensClosedVersionId !== previous.id
      || row.effectiveTermsVersionId !== null
      || row.snapshotId !== null
    ) return false;
    previous = row;
  }
  if (ids.size !== rows.length || versions.size !== rows.length) return false;
  const visited = new Set();
  let cursor = roots[0];
  while (cursor) {
    if (visited.has(cursor.id)) return false;
    visited.add(cursor.id);
    const nextRows = successors.get(cursor.id) || [];
    cursor = nextRows[0] || null;
  }
  if (visited.size !== rows.length) return false;
  return previous.eventType === 'closed' && previous.id === candidate.closedPeriodVersionId;
}

function assertLifecycleSnapshotUnchanged(db, context) {
  if (!hasValidUniqueCurrentClosedPeriod(db, context.candidate)) {
    throw repositoryError('CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED');
  }
}

function currentRevisionKeysHash(keys) {
  return sha256Canonical({
    currentSourceRevisionKeys: [...keys].sort(compareUtf16Ascending),
    domain: 'rentcore.canonical_actual_posting.current_revision_keys',
    version: 1,
  });
}

function rootLineageIdsHash(domain, key, values) {
  return sha256Canonical({
    domain,
    [key]: [...new Set(values)].sort(compareUtf16Ascending),
    version: 1,
  });
}

function brokenSuccessorDenial(db, candidate, relationInput, rootCoverageLineageId, edgeFailureState) {
  const economicLineageCandidateFingerprint = sourceCandidateFingerprint(candidate);
  const relations = Array.isArray(relationInput) ? relationInput : [relationInput];
  const brokenEdges = relations.map(relation => {
    const relationRowFingerprint = persistedRowFingerprint(
      db,
      BILLING_SOURCE_COVERAGE_SUPERSESSIONS_TABLE,
      relation,
    ).rowFingerprint;
    const brokenEdgeFingerprint = sha256Canonical({
      branchId: candidate.branchId,
      companyId: candidate.companyId,
      domain: 'rentcore.canonical_actual_posting.broken_successor_edge',
      edgeFailureState,
      fromCoverageSetId: relation.originalCoverageSetId,
      relationRowFingerprint,
      rootCoverageLineageId,
      toCoverageSetId: relation.replacementCoverageSetId,
      version: 1,
    });
    return {
      brokenEdgeFingerprint,
      edgeFailureState,
      fromCoverageSetId: relation.originalCoverageSetId,
      toCoverageSetId: relation.replacementCoverageSetId,
    };
  }).sort((left, right) => compareUtf16Ascending(canonicalJson(left), canonicalJson(right)));
  const edgesHash = edges => sha256Canonical({
    brokenEdges: edges,
    domain: 'rentcore.canonical_actual_posting.broken_successor_edges',
    version: 1,
  });
  return Object.freeze({
    conflictType: 'SOURCE_LINEAGE_BROKEN_SUCCESSOR',
    expectedSpecific: {
      branchId: candidate.branchId,
      brokenEdgeCount: 0,
      brokenEdgeFingerprint: null,
      brokenEdgesHash: edgesHash([]),
      brokenEdgeFromId: null,
      brokenEdgeToId: null,
      companyId: candidate.companyId,
      economicLineageCandidateFingerprint,
      rootCoverageLineageId,
      successorObservationState: 'complete',
    },
    observedSpecific: {
      branchId: candidate.branchId,
      brokenEdgeCount: brokenEdges.length,
      brokenEdgeFingerprint: brokenEdges.length === 1 ? brokenEdges[0].brokenEdgeFingerprint : null,
      brokenEdgesHash: edgesHash(brokenEdges),
      brokenEdgeFromId: brokenEdges.length === 1 ? brokenEdges[0].fromCoverageSetId : null,
      brokenEdgeToId: brokenEdges.length === 1 ? brokenEdges[0].toCoverageSetId : null,
      companyId: candidate.companyId,
      economicLineageCandidateFingerprint,
      rootCoverageLineageId,
      successorObservationState: 'broken',
    },
  });
}

function analyzeLockedSourceGraph(db, acceptedCandidate) {
  const economicLineageCandidateFingerprint = sourceCandidateFingerprint(acceptedCandidate);
  const logicalCoverageRows = sameScopeLogicalCoverageRows(db, acceptedCandidate);
  const logicalSetIds = [...new Set(logicalCoverageRows.map(row => row.coverageSetId))]
    .sort(compareUtf16Ascending);
  const logicalSetIdSet = new Set(logicalSetIds);
  const logicalEdges = db.prepare(`
    SELECT * FROM ${BILLING_SOURCE_COVERAGE_SUPERSESSIONS_TABLE}
    WHERE companyId = ? AND branchId = ?
    ORDER BY originalCoverageSetId ASC, replacementCoverageSetId ASC, action ASC, id ASC
  `).all(acceptedCandidate.companyId, acceptedCandidate.branchId).filter(row => (
    logicalSetIdSet.has(row.originalCoverageSetId)
    || (row.replacementCoverageSetId !== null && logicalSetIdSet.has(row.replacementCoverageSetId))
  ));
  const hasExternallyBrokenSuccessor = logicalEdges.some(edge => (
    logicalSetIdSet.has(edge.originalCoverageSetId)
    && edge.replacementCoverageSetId !== null
    && !logicalSetIdSet.has(edge.replacementCoverageSetId)
  ));
  const incoming = new Map(logicalSetIds.map(id => [id, 0]));
  const adjacency = new Map(logicalSetIds.map(id => [id, new Set()]));
  for (const edge of logicalEdges) {
    if (!logicalSetIdSet.has(edge.originalCoverageSetId) || edge.replacementCoverageSetId === null) continue;
    if (!logicalSetIdSet.has(edge.replacementCoverageSetId)) continue;
    incoming.set(edge.replacementCoverageSetId, (incoming.get(edge.replacementCoverageSetId) || 0) + 1);
    adjacency.get(edge.originalCoverageSetId).add(edge.replacementCoverageSetId);
    adjacency.get(edge.replacementCoverageSetId).add(edge.originalCoverageSetId);
  }
  const roots = logicalSetIds.filter(id => (incoming.get(id) || 0) === 0);
  const visitedLogicalSets = new Set();
  let componentCount = 0;
  for (const setId of logicalSetIds) {
    if (visitedLogicalSets.has(setId)) continue;
    componentCount += 1;
    const pending = [setId];
    while (pending.length > 0) {
      const current = pending.pop();
      if (visitedLogicalSets.has(current)) continue;
      visitedLogicalSets.add(current);
      for (const neighbor of adjacency.get(current) || []) pending.push(neighbor);
    }
  }
  const externalBreakExplainsSingleDetachedTarget = (
    hasExternallyBrokenSuccessor
    && roots.length === 2
    && componentCount === 2
  );
  if (
    !externalBreakExplainsSingleDetachedTarget
    && (logicalSetIds.length === 0 || roots.length !== 1 || componentCount !== 1)
  ) {
    const rootSourceDocumentLineageIds = [...new Set(roots.map(rootId => (
      logicalCoverageRows.find(row => row.coverageSetId === rootId)?.graphUpdId
      ?? logicalCoverageRows.find(row => row.coverageSetId === rootId)?.updId
      ?? null
    )).filter(Boolean))].sort(compareUtf16Ascending);
    return Object.freeze({
      currentCandidate: acceptedCandidate,
      denial: Object.freeze({
        conflictType: 'SOURCE_LINEAGE_ROOT_CONFLICT',
        expectedSpecific: {
          economicLineageCandidateFingerprint,
          rootCount: 1,
          rootCoverageLineageIdsHash: null,
          rootObservationState: 'unique',
          rootSourceDocumentLineageIdsHash: null,
        },
        observedSpecific: {
          economicLineageCandidateFingerprint,
          rootCount: roots.length,
          rootCoverageLineageIdsHash: rootLineageIdsHash(
            'rentcore.canonical_actual_posting.root_lineage_ids',
            'rootCoverageLineageIds',
            roots,
          ),
          rootObservationState: logicalSetIds.length === 0
            ? 'missing'
            : roots.length === 0 ? 'cycle' : 'disconnected_roots',
          rootSourceDocumentLineageIdsHash: rootLineageIdsHash(
            'rentcore.canonical_actual_posting.root_source_document_lineage_ids',
            'rootSourceDocumentLineageIds',
            rootSourceDocumentLineageIds,
          ),
        },
      }),
    });
  }
  const visitedPredecessors = new Set();
  let rootSetId = acceptedCandidate.coverageSetId;
  let rootSliceId = acceptedCandidate.coverageSliceId;
  let rootObservationState = 'unique';
  let competingRoots = [];
  while (true) {
    if (visitedPredecessors.has(rootSetId)) {
      rootObservationState = 'cycle';
      competingRoots = [];
      break;
    }
    visitedPredecessors.add(rootSetId);
    const predecessors = db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_COVERAGE_SUPERSESSIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND replacementCoverageSetId = ?
      ORDER BY originalCoverageSetId ASC, id ASC
    `).all(acceptedCandidate.companyId, acceptedCandidate.branchId, rootSetId);
    if (predecessors.length === 0) {
      competingRoots = [rootSetId];
      break;
    }
    if (predecessors.length > 1) {
      rootObservationState = 'ambiguous_predecessor';
      competingRoots = predecessors.map(row => row.originalCoverageSetId);
      break;
    }
    const predecessor = predecessors[0];
    const predecessorSet = db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_COVERAGE_SETS_TABLE}
      WHERE id = ? AND companyId = ? AND branchId = ?
    `).get(predecessor.originalCoverageSetId, acceptedCandidate.companyId, acceptedCandidate.branchId);
    const predecessorSlices = predecessorSet ? db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_COVERAGE_SLICES_TABLE}
      WHERE companyId = ? AND branchId = ? AND coverageSetId = ?
        AND rentalId = ? AND rentalLineId = ? AND periodId = ?
        AND sliceStartDate = ? AND sliceEndDateExclusive = ? AND currency = ?
        AND contractId IS ?
      ORDER BY id ASC
    `).all(
      acceptedCandidate.companyId,
      acceptedCandidate.branchId,
      predecessor.originalCoverageSetId,
      acceptedCandidate.rentalId,
      acceptedCandidate.rentalLineId,
      acceptedCandidate.periodId,
      acceptedCandidate.sliceStartDate,
      acceptedCandidate.sliceEndDateExclusive,
      acceptedCandidate.currency,
      acceptedCandidate.contractId,
    ) : [];
    if (!predecessorSet || predecessorSlices.length !== 1) {
      rootObservationState = 'broken_predecessor';
      competingRoots = predecessorSet ? [predecessorSet.id] : [];
      break;
    }
    if (predecessorSet.updId !== acceptedCandidate.updId) {
      rootObservationState = 'cross_lineage_collision';
      competingRoots = [predecessorSet.id];
      break;
    }
    rootSetId = predecessorSet.id;
    rootSliceId = predecessorSlices[0].id;
  }
  if (rootObservationState !== 'unique') {
    const rootCoverageLineageIds = competingRoots;
    const rootSourceDocumentLineageIds = competingRoots.map(() => acceptedCandidate.updId);
    return Object.freeze({
      currentCandidate: acceptedCandidate,
      denial: Object.freeze({
        conflictType: 'SOURCE_LINEAGE_ROOT_CONFLICT',
        expectedSpecific: {
          economicLineageCandidateFingerprint,
          rootCount: 1,
          rootCoverageLineageIdsHash: null,
          rootObservationState: 'unique',
          rootSourceDocumentLineageIdsHash: null,
        },
        observedSpecific: {
          economicLineageCandidateFingerprint,
          rootCount: new Set(competingRoots).size,
          rootCoverageLineageIdsHash: rootLineageIdsHash(
            'rentcore.canonical_actual_posting.root_lineage_ids',
            'rootCoverageLineageIds',
            rootCoverageLineageIds,
          ),
          rootObservationState,
          rootSourceDocumentLineageIdsHash: rootLineageIdsHash(
            'rentcore.canonical_actual_posting.root_source_document_lineage_ids',
            'rootSourceDocumentLineageIds',
            rootSourceDocumentLineageIds,
          ),
        },
      }),
    });
  }

  const rootCoverageLineageId = computeCoverageLineageRootId({
    branchId: acceptedCandidate.branchId,
    companyId: acceptedCandidate.companyId,
    rootCoverageSetId: rootSetId,
    rootCoverageSliceId: rootSliceId,
    rootSourceDocumentLineageId: acceptedCandidate.updId,
  });
  const economicLineageKey = computeEconomicLineageKey({
    branchId: acceptedCandidate.branchId,
    companyId: acceptedCandidate.companyId,
    contractId: acceptedCandidate.contractId ?? null,
    coverageEndExclusive: acceptedCandidate.sliceEndDateExclusive,
    coverageStart: acceptedCandidate.sliceStartDate,
    currency: acceptedCandidate.currency,
    rentalId: acceptedCandidate.rentalId,
    rentalLineId: acceptedCandidate.rentalLineId,
    rootCoverageLineageId,
    rootSourceDocumentLineageId: acceptedCandidate.updId,
  });

  let currentSetId = rootSetId;
  let currentSlice = db.prepare(`
    SELECT * FROM ${BILLING_SOURCE_COVERAGE_SLICES_TABLE} WHERE id = ?
  `).get(rootSliceId);
  const visitedSuccessors = new Set();
  while (true) {
    if (visitedSuccessors.has(currentSetId)) {
      return Object.freeze({
        currentCandidate: acceptedCandidate,
        denial: Object.freeze({
          conflictType: 'SOURCE_LINEAGE_ROOT_CONFLICT',
          expectedSpecific: {
            economicLineageCandidateFingerprint,
            rootCount: 1,
            rootCoverageLineageIdsHash: null,
            rootObservationState: 'unique',
            rootSourceDocumentLineageIdsHash: null,
          },
          observedSpecific: {
            economicLineageCandidateFingerprint,
            rootCount: 0,
            rootCoverageLineageIdsHash: rootLineageIdsHash(
              'rentcore.canonical_actual_posting.root_lineage_ids',
              'rootCoverageLineageIds',
              [],
            ),
            rootObservationState: 'cycle',
            rootSourceDocumentLineageIdsHash: rootLineageIdsHash(
              'rentcore.canonical_actual_posting.root_source_document_lineage_ids',
              'rootSourceDocumentLineageIds',
              [],
            ),
          },
        }),
      });
    }
    visitedSuccessors.add(currentSetId);
    const successors = db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_COVERAGE_SUPERSESSIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND originalCoverageSetId = ?
      ORDER BY replacementCoverageSetId ASC, action ASC, id ASC
    `).all(acceptedCandidate.companyId, acceptedCandidate.branchId, currentSetId);
    if (successors.length === 0) break;
    if (successors.length !== 1) {
      return Object.freeze({
        currentCandidate: acceptedCandidate,
        denial: brokenSuccessorDenial(
          db,
          acceptedCandidate,
          successors,
          rootCoverageLineageId,
          'forked_successor',
        ),
      });
    }
    const successor = successors[0];
    if (successor.action === 'cancelled') {
      currentSlice = null;
      break;
    }
    const replacement = db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_COVERAGE_SETS_TABLE}
      WHERE id = ? AND companyId = ? AND branchId = ?
    `).get(
      successor.replacementCoverageSetId,
      acceptedCandidate.companyId,
      acceptedCandidate.branchId,
    );
    const slices = replacement ? db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_COVERAGE_SLICES_TABLE}
      WHERE companyId = ? AND branchId = ? AND coverageSetId = ?
        AND rentalId = ? AND rentalLineId = ? AND periodId = ?
        AND sliceStartDate = ? AND sliceEndDateExclusive = ? AND currency = ?
        AND contractId IS ?
      ORDER BY id ASC
    `).all(
      acceptedCandidate.companyId,
      acceptedCandidate.branchId,
      replacement.id,
      acceptedCandidate.rentalId,
      acceptedCandidate.rentalLineId,
      acceptedCandidate.periodId,
      acceptedCandidate.sliceStartDate,
      acceptedCandidate.sliceEndDateExclusive,
      acceptedCandidate.currency,
      acceptedCandidate.contractId,
    ) : [];
    if (!replacement || replacement.updId !== acceptedCandidate.updId || slices.length !== 1) {
      return Object.freeze({
        currentCandidate: acceptedCandidate,
        denial: brokenSuccessorDenial(
          db,
          acceptedCandidate,
          successor,
          rootCoverageLineageId,
          replacement && replacement.updId !== acceptedCandidate.updId
            ? 'root_mismatch'
            : 'missing_successor',
        ),
      });
    }
    currentSetId = replacement.id;
    currentSlice = slices[0];
  }

  const candidateForSlice = currentSlice ? {
    ...acceptedCandidate,
    clientId: currentSlice.clientId,
    closedPeriodVersionId: currentSlice.closedPeriodVersionId,
    contractualDueDate: currentSlice.contractualDueDate,
    contractId: currentSlice.contractId,
    coverageSetId: currentSlice.coverageSetId,
    coverageSliceId: currentSlice.id,
    dueDateEvidenceRef: currentSlice.dueDateEvidenceRef,
    dueDateProvenance: currentSlice.dueDateProvenance,
    formedUpdVersionId: currentSlice.formedUpdVersionId,
    sourceGrossMinor: Number(currentSlice.allocatedGrossMinor),
    sourceNetMinor: Number(currentSlice.allocatedNetMinor),
    sourceVatMinor: Number(currentSlice.allocatedVatMinor),
    snapshotId: currentSlice.snapshotId,
    updId: currentSlice.updId,
    updLineId: currentSlice.updLineId,
    updLineVersionId: currentSlice.updLineVersionId,
  } : null;
  const periodIsCurrent = candidateForSlice
    && hasValidUniqueCurrentClosedPeriod(db, candidateForSlice);
  const conductedRows = periodIsCurrent ? db.prepare(`
    SELECT * FROM ${BILLING_SOURCE_UPD_VERSIONS_TABLE}
    WHERE companyId = ? AND branchId = ? AND updId = ?
      AND formedVersionId = ? AND state = 'conducted'
    ORDER BY version ASC, id ASC
  `).all(
    acceptedCandidate.companyId,
    acceptedCandidate.branchId,
    candidateForSlice.updId,
    candidateForSlice.formedUpdVersionId,
  ) : [];
  const revisionCandidates = conductedRows.map(row => ({
    ...candidateForSlice,
    currentConductedUpdVersionId: row.id,
  }));
  const revisionKeys = revisionCandidates.map(revisionCandidate => {
    const lineageRows = reconstructPr6LineageRows(db, revisionCandidate);
    const revisionHash = currentPr6RevisionHash(db, revisionCandidate, lineageRows);
    return computeEconomicSourceRevisionKey({
      branchId: revisionCandidate.branchId,
      companyId: revisionCandidate.companyId,
      conductedUpdVersionId: revisionCandidate.currentConductedUpdVersionId,
      coverageSetId: revisionCandidate.coverageSetId,
      coverageSliceId: revisionCandidate.coverageSliceId,
      currentPr6RevisionHash: revisionHash,
      economicLineageKey,
      formedUpdVersionId: revisionCandidate.formedUpdVersionId,
      updLineVersionId: revisionCandidate.updLineVersionId,
    });
  }).sort(compareUtf16Ascending);
  if (revisionCandidates.length !== 1) {
    const conflictType = revisionCandidates.length === 0
      ? 'SOURCE_LINEAGE_NO_CURRENT_REVISION'
      : 'SOURCE_LINEAGE_MULTIPLE_CURRENT_REVISIONS';
    const state = revisionCandidates.length === 0 ? 'missing' : 'multiple';
    return Object.freeze({
      currentCandidate: acceptedCandidate,
      denial: Object.freeze({
        conflictType,
        expectedSpecific: {
          currentRevisionCount: 1,
          currentRevisionKey: null,
          currentRevisionKeysHash: null,
          currentRevisionState: 'unique',
          economicLineageKey,
          rootCoverageLineageId,
        },
        observedSpecific: {
          currentRevisionCount: revisionCandidates.length,
          currentRevisionKey: null,
          currentRevisionKeysHash: currentRevisionKeysHash(revisionKeys),
          currentRevisionState: state,
          economicLineageKey,
          rootCoverageLineageId,
        },
      }),
    });
  }
  return Object.freeze({
    currentCandidate: Object.freeze(revisionCandidates[0]),
    denial: null,
  });
}

function currentPr6RevisionHash(db, candidate, pr6LineageRows) {
  const conducted = db.prepare(`SELECT * FROM ${BILLING_SOURCE_UPD_VERSIONS_TABLE} WHERE id = ?`).get(
    candidate.currentConductedUpdVersionId,
  );
  const formed = db.prepare(`SELECT * FROM ${BILLING_SOURCE_UPD_VERSIONS_TABLE} WHERE id = ?`).get(
    candidate.formedUpdVersionId,
  );
  const line = db.prepare(`SELECT * FROM ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE} WHERE id = ?`).get(
    candidate.updLineVersionId,
  );
  const set = db.prepare(`SELECT * FROM ${BILLING_SOURCE_COVERAGE_SETS_TABLE} WHERE id = ?`).get(
    candidate.coverageSetId,
  );
  const slice = db.prepare(`SELECT * FROM ${BILLING_SOURCE_COVERAGE_SLICES_TABLE} WHERE id = ?`).get(
    candidate.coverageSliceId,
  );
  if (!conducted || !formed || !line || !set || !slice) throw repositoryError('SOURCE_LINEAGE_NO_CURRENT_REVISION');
  if (conducted.state !== 'conducted' || set.status !== 'validated') {
    throw repositoryError('SOURCE_LINEAGE_NO_CURRENT_REVISION');
  }
  return sha256Canonical({
    branchId: candidate.branchId,
    companyId: candidate.companyId,
    conductedUpdContentHash: conducted.contentHash,
    conductedUpdVersionId: conducted.id,
    coverageSetId: set.id,
    coverageSetMappingHash: set.mappingHash,
    coverageSliceHash: slice.sliceHash,
    coverageSliceId: slice.id,
    domain: 'rentcore.canonical_actual_posting.pr6_current_revision',
    formedUpdVersionId: formed.id,
    pr6LineageRows,
    updLineVersionContentHash: line.contentHash,
    updLineVersionId: line.id,
    version: 1,
  });
}

function assertActiveWindow(record, attemptedAt, code) {
  if (
    record.status !== 'authorized'
    || attemptedAt < parseUtcMilliseconds(record.effectiveFrom)
    || attemptedAt >= parseUtcMilliseconds(record.expiresAt)
  ) throw repositoryError(code);
}

function parsePr8CanonicalJson(value, field, expectedType) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw repositoryError('PR8_EVIDENCE_MISMATCH', `Invalid PR8 JSON: ${field}`);
  }
  if (
    pr8StableJson(parsed) !== value
    || (expectedType === 'array' && !Array.isArray(parsed))
    || (expectedType === 'object' && (!parsed || Array.isArray(parsed) || typeof parsed !== 'object'))
  ) throw repositoryError('PR8_EVIDENCE_MISMATCH', `Non-canonical PR8 JSON: ${field}`);
  return parsed;
}

function selectedRunPolicyBinding(run, command, candidate) {
  const invalid = Object.freeze({
    amountBasisValid: false,
    dueDatePolicySet: null,
    dueDatePoliciesValid: false,
  });
  if (!run?.policyManifestJson) return invalid;
  try {
    const manifest = parsePr8CanonicalJson(run.policyManifestJson, 'policyManifestJson', 'object');
    if (
      canonicalJson(Object.keys(manifest).sort(compareUtf16Ascending))
        !== canonicalJson(['gates', 'manifestId', 'manifestVersion', 'schemaVersion'])
      || typeof manifest.manifestId !== 'string'
      || manifest.manifestId.length === 0
      || !Number.isSafeInteger(manifest.manifestVersion)
      || manifest.manifestVersion < 1
      || manifest.schemaVersion !== 1
      || !Array.isArray(manifest.gates)
    ) return invalid;
    const named = Object.fromEntries([
      'canonical_amount_basis',
      'contractual_due_date',
      'unknown_due_date_treatment',
    ].map(key => [key, manifest.gates.filter(gate => gate?.key === key)]));
    if (Object.values(named).some(matches => matches.length !== 1)) return invalid;
    const expectedGateKeys = canonicalJson([
      'decisionHash', 'decisionRef', 'decisionValue', 'decisionVersion', 'expectedSourceRef',
      'key', 'schemaVersion', 'scope', 'status',
    ]);
    const gateValid = gate => (
      gate
      && canonicalJson(Object.keys(gate).sort(compareUtf16Ascending)) === expectedGateKeys
      && gate.status === 'approved_by_reference'
      && typeof gate.decisionRef === 'string'
      && gate.decisionRef.length > 0
      && Number.isSafeInteger(gate.decisionVersion)
      && gate.decisionVersion > 0
      && typeof gate.decisionHash === 'string'
      && /^[0-9a-f]{64}$/.test(gate.decisionHash)
      && gate.schemaVersion === 1
      && gate.scope
      && !Array.isArray(gate.scope)
      && canonicalJson(Object.keys(gate.scope).sort(compareUtf16Ascending))
        === canonicalJson(['branchId', 'companyId', 'contractId'])
      && gate.scope.companyId === command.companyId
      && gate.scope.branchId === command.branchId
      && (gate.scope.contractId === null || gate.scope.contractId === candidate.contractId)
    );
    const contractual = named.contractual_due_date[0];
    const unknown = named.unknown_due_date_treatment[0];
    const amount = named.canonical_amount_basis[0];
    const dueDateGatesValid = (
      gateValid(contractual)
      && typeof contractual.expectedSourceRef === 'string'
      && contractual.expectedSourceRef.length > 0
      && contractual.decisionValue === null
      && gateValid(unknown)
      && unknown.expectedSourceRef === null
    );
    const dueDatePoliciesValid = (
      dueDateGatesValid
      && unknown.decisionValue === 'allow_unknown_without_aging'
    );
    const dueDatePolicySet = dueDateGatesValid ? Object.freeze({
      contractualDueDate: Object.freeze({
        expectedSourceRef: contractual.expectedSourceRef,
        gateKind: contractual.key,
        policyHash: contractual.decisionHash,
        policyId: contractual.decisionRef,
        policyVersion: contractual.decisionVersion,
      }),
      unknownDueDateTreatment: Object.freeze({
        decisionLiteral: 'allow_unknown_without_aging',
        gateKind: unknown.key,
        mappingHash: computeUnknownDueDateMappingHash(),
        mappingId: 'rentcore.unknown_due_date_posting_treatment.v1',
        mappingVersion: 1,
        policyHash: unknown.decisionHash,
        policyId: unknown.decisionRef,
        policyVersion: unknown.decisionVersion,
      }),
    }) : null;
    return Object.freeze({
      amountBasisGate: gateValid(amount) ? Object.freeze(amount) : null,
      amountBasisValid: (
        gateValid(amount)
        && amount.decisionVersion === 1
        && amount.decisionValue === 'slice_gross_minor'
      ),
      dueDatePolicySet,
      dueDatePoliciesValid,
    });
  } catch {
    return invalid;
  }
}

function assertPr8RowShape(row, table) {
  if (!row) throw repositoryError('PR8_EVIDENCE_MISMATCH');
  const expected = [...PR8_REQUIRED_COLUMNS[table]].sort(compareUtf16Ascending);
  const actual = Object.keys(row).sort(compareUtf16Ascending);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw repositoryError('PR8_EVIDENCE_MISMATCH', `PR8 row shape mismatch: ${table}`);
  }
}

function pr8CandidateResultCanonical(row, blockerCodes) {
  return {
    candidateKey: row.candidateKey,
    sourceNetMinor: Number(row.sourceNetMinor),
    sourceVatMinor: Number(row.sourceVatMinor),
    sourceGrossMinor: Number(row.sourceGrossMinor),
    proposedOriginalAmountMinor: row.proposedOriginalAmountMinor == null
      ? null
      : Number(row.proposedOriginalAmountMinor),
    status: row.status,
    blockerCodes,
    policyManifestHash: row.policyManifestHash,
    inputLineageHash: row.inputLineageHash,
    diagnosticOnly: true,
    canonicalWriteAuthorized: false,
    productionActivationAuthorized: false,
  };
}

function pr8CheckCanonical(row, candidateKey, sourceEvidenceRefs) {
  return {
    candidateKey,
    gateCode: row.gateCode,
    outcome: row.outcome,
    policyDecisionRef: row.policyDecisionRef ?? null,
    policyDecisionVersion: row.policyDecisionVersion == null
      ? null
      : Number(row.policyDecisionVersion),
    policyDecisionHash: row.policyDecisionHash ?? null,
    sourceEvidenceRefs,
    expectedFingerprint: row.expectedFingerprint ?? null,
    observedFingerprint: row.observedFingerprint ?? null,
    reasonCode: row.reasonCode ?? null,
  };
}

function pr8ReconciliationCanonical(row, candidateKey, dimensionIds) {
  return {
    candidateKey,
    dimensionKind: row.dimensionKind,
    dimensionIds,
    expected: {
      netMinor: Number(row.expectedNetMinor),
      vatMinor: Number(row.expectedVatMinor),
      grossMinor: Number(row.expectedGrossMinor),
    },
    observed: {
      netMinor: Number(row.observedNetMinor),
      vatMinor: Number(row.observedVatMinor),
      grossMinor: Number(row.observedGrossMinor),
    },
    delta: {
      netMinor: Number(row.deltaNetMinor),
      vatMinor: Number(row.deltaVatMinor),
      grossMinor: Number(row.deltaGrossMinor),
    },
    currency: row.currency,
    reconciliationRuleVersion: row.reconciliationRuleVersion,
    sourceInputHash: row.sourceInputHash,
    blockerState: Boolean(row.blockerState),
  };
}

function pr8DiagnosticCanonical(row, candidateKey, expectedEvidence, observedEvidence, policyReferences) {
  return {
    candidateKey,
    severity: row.severity,
    code: row.code,
    sourceKind: row.sourceKind ?? null,
    sourceId: row.sourceId ?? null,
    sourceVersion: row.sourceVersion == null ? null : Number(row.sourceVersion),
    affectedStartDate: row.affectedStartDate ?? null,
    affectedEndDateExclusive: row.affectedEndDateExclusive ?? null,
    expectedEvidence,
    observedEvidence,
    policyReferences,
    detectorVersion: row.detectorVersion,
  };
}

function deniedFreshnessWindowFingerprint({ deniedAttemptedAt, freshnessState, freshnessWindowFingerprint }) {
  return sha256Canonical({
    deniedAttemptedAt,
    domain: 'rentcore.canonical_actual_posting.denied_pr8_freshness_window',
    freshnessState,
    freshnessWindowFingerprint,
    version: 1,
  });
}

function observedAcceptedDryRunsHash(acceptedDryRuns) {
  const normalized = Array.isArray(acceptedDryRuns) ? acceptedDryRuns.map(entry => ({
    dryRunId: entry?.dryRunId ?? null,
    resultHash: entry?.resultHash ?? null,
  })).sort((left, right) => compareUtf16Ascending(
    String(left.dryRunId),
    String(right.dryRunId),
  )) : [];
  return sha256Canonical({
    acceptedDryRuns: normalized,
    domain: 'rentcore.canonical_actual_posting.accepted_dry_runs',
    version: 1,
  });
}

function observedAcceptedPr8EvidenceHash({
  acceptedDryRunsHash,
  acceptedFreshnessWindowsHash,
  acceptedRuns,
  evidencePackHash,
}) {
  const normalized = Array.isArray(acceptedRuns) ? [...acceptedRuns].sort((left, right) => (
    compareUtf16Ascending(String(left?.dryRunId), String(right?.dryRunId))
  )) : [];
  return sha256Canonical({
    acceptedDryRunsHash,
    acceptedFreshnessWindowsHash,
    acceptedRuns: normalized,
    domain: 'rentcore.canonical_actual_posting.accepted_pr8_evidence',
    evidencePackHash,
    version: 1,
  });
}

function observedAcceptedFreshnessWindowsHash(acceptedRuns) {
  const windows = Array.isArray(acceptedRuns) ? acceptedRuns.map(entry => ({
    dryRunId: entry?.dryRunId ?? null,
    freshnessWindowFingerprint: entry?.freshnessWindowFingerprint ?? null,
  })).sort((left, right) => compareUtf16Ascending(
    String(left.dryRunId),
    String(right.dryRunId),
  )) : [];
  return sha256Canonical({
    domain: 'rentcore.canonical_actual_posting.accepted_freshness_windows',
    version: 1,
    windows,
  });
}

function temporalState(record, attemptedAt) {
  if (!record) return 'missing';
  if (attemptedAt < parseUtcMilliseconds(record.effectiveFrom)) return 'not_yet_effective';
  if (attemptedAt >= parseUtcMilliseconds(record.expiresAt)) return 'expired';
  return 'active';
}

function verifyPr8EvidenceGraph(
  db,
  command,
  authorization,
  activation,
  deniedAttemptedAt,
  { validateCompleteAcceptanceSet = true } = {},
) {
  const attemptedAt = parseUtcMilliseconds(deniedAttemptedAt);
  const run = db.prepare(`SELECT * FROM ${ACTUAL_SOURCE_DRY_RUNS_TABLE} WHERE id = ?`).get(command.dryRunId);
  const candidate = db.prepare(`
    SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} WHERE id = ? AND runId = ?
  `).get(command.candidateId, command.dryRunId);
  const acceptedDryRuns = parseCanonicalJson(authorization.acceptedDryRunsJson, 'acceptedDryRunsJson');
  const acceptedRuns = parseCanonicalJson(authorization.acceptedPr8EvidenceJson, 'acceptedPr8EvidenceJson');
  const acceptedRun = acceptedRuns.find(entry => entry.dryRunId === command.dryRunId) || null;
  const acceptedPair = acceptedDryRuns.find(entry => entry.dryRunId === command.dryRunId) || null;
  const reasons = [];
  const requireProof = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };
  let reconstructedResultHash = run?.resultHash ?? null;
  let reconstructedReconciliationSetHash = null;
  let freshnessState = 'invalid_window';
  let observedFreshnessWindowFingerprint = acceptedRun?.freshnessWindowFingerprint ?? null;

  try {
    assertPr8RowShape(run, ACTUAL_SOURCE_DRY_RUNS_TABLE);
    assertPr8RowShape(candidate, ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE);
    requireProof(run.companyId === command.companyId && run.branchId === command.branchId, 'run_scope');
    requireProof(candidate.companyId === command.companyId && candidate.branchId === command.branchId, 'candidate_scope');
    requireProof(candidate.runId === run.id && candidate.id === command.candidateId, 'candidate_identity');
    requireProof(
      candidate.sliceStartDate >= activation.forwardOnlyStartDate,
      'activation_boundary_membership',
    );

    const inputRows = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE}
      WHERE runId = ? ORDER BY deterministicOrderKey ASC, id ASC
    `).all(run.id);
    const candidateRows = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE}
      WHERE runId = ? ORDER BY candidateKey ASC, id ASC
    `).all(run.id);
    const checkRows = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE} WHERE runId = ?
    `).all(run.id);
    const reconciliationRows = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE} WHERE runId = ?
    `).all(run.id);
    const diagnosticRows = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE} WHERE runId = ?
    `).all(run.id);
    const operationRows = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE} WHERE resultRunId = ?
    `).all(run.id);
    const auditRows = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE} WHERE aggregateId = ?
    `).all(run.id);
    const childSets = [
      [inputRows, ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE],
      [candidateRows, ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE],
      [checkRows, ACTUAL_SOURCE_DRY_RUN_CHECKS_TABLE],
      [reconciliationRows, ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE],
      [diagnosticRows, ACTUAL_SOURCE_DRY_RUN_DIAGNOSTICS_TABLE],
      [operationRows, ACTUAL_SOURCE_DRY_RUN_OPERATIONS_TABLE],
      [auditRows, ACTUAL_SOURCE_DRY_RUN_AUDIT_EVENTS_TABLE],
    ];
    for (const [rows, table] of childSets) {
      for (const row of rows) {
        assertPr8RowShape(row, table);
        requireProof(row.companyId === run.companyId && row.branchId === run.branchId, `${table}_scope`);
      }
      requireProof(new Set(rows.map(row => row.id)).size === rows.length, `${table}_duplicate_id`);
    }

    const policyManifest = parsePr8CanonicalJson(run.policyManifestJson, 'policyManifestJson', 'object');
    const sourceManifest = parsePr8CanonicalJson(run.sourceInputManifestJson, 'sourceInputManifestJson', 'array');
    requireProof(pr8Fingerprint(policyManifest) === run.policyManifestHash, 'policy_manifest_hash');
    const inputRelationshipColumns = [
      'activationBoundaryId', 'rentalLineId', 'periodId', 'closedPeriodVersionId',
      'snapshotId', 'updId', 'updLineId', 'updLineVersionId',
      'coverageSetId', 'sourceOperationId',
    ];
    const persistedInputs = inputRows.map(row => {
      const relationships = parsePr8CanonicalJson(
        row.relationshipJson,
        'relationshipJson',
        'object',
      );
      requireProof(row.sourceTableIdentity === row.sourceKind, 'input_table_identity');
      requireProof(
        BILLING_SOURCE_AUTHORITY_TABLES.includes(row.sourceKind),
        'input_source_kind',
      );
      requireProof(
        row.deterministicOrderKey === pr8Fingerprint({
          sourceKind: row.sourceKind,
          sourceId: row.sourceId,
        }),
        'input_deterministic_order_key',
      );
      requireProof(
        inputRelationshipColumns.every(column => (
          row[column] === null
          || relationships[column === 'sourceOperationId' ? 'operationId' : column] === row[column]
        )),
        'input_relationship_binding',
      );
      requireProof(Number(row.schemaVersion) === 1 && row.createdAt === run.createdAt, 'input_seal');
      return {
        row,
        relationships,
        manifest: {
          sourceKind: row.sourceKind,
          sourceId: row.sourceId,
          sourceVersion: row.sourceVersion == null ? null : Number(row.sourceVersion),
          externalAssertionHash: row.externalAssertionHash ?? null,
          normalizedInputHash: row.normalizedInputHash,
          deterministicOrderKey: row.deterministicOrderKey,
        },
      };
    });
    const reconstructedManifest = persistedInputs.map(input => input.manifest);
    requireProof(pr8StableJson(reconstructedManifest) === run.sourceInputManifestJson, 'input_order_or_membership');
    const expectedCounts = Object.fromEntries(BILLING_SOURCE_AUTHORITY_TABLES.map(table => [
      table,
      reconstructedManifest.filter(input => input.sourceKind === table).length,
    ]));
    const reconstructedInputHash = pr8Fingerprint({
      sourceContractVersion: 'billing-source-authority-pr6-complete-branch-manifest-v1',
      companyId: run.companyId,
      branchId: run.branchId,
      expectedCounts,
      inputs: reconstructedManifest,
    });
    requireProof(reconstructedInputHash === run.sourceInputManifestHash, 'input_set_hash');
    requireProof(pr8StableJson(sourceManifest) === pr8StableJson(reconstructedManifest), 'input_manifest');

    const candidateKeysById = new Map();
    const persistedCandidates = candidateRows.map(row => {
      const blockerCodes = parsePr8CanonicalJson(row.blockerCodesJson, 'blockerCodesJson', 'array');
      requireProof(!candidateKeysById.has(row.id), 'candidate_duplicate');
      candidateKeysById.set(row.id, row.candidateKey);
      const canonical = pr8CandidateResultCanonical(row, blockerCodes);
      const recomputedHash = pr8Fingerprint(canonical);
      requireProof(recomputedHash === row.resultHash, 'candidate_hash');
      const inputByIdentity = new Map(persistedInputs.map(input => [
        `${input.row.sourceKind}:${input.row.sourceId}`,
        input,
      ]));
      const inputVersion = (kind, id) => inputByIdentity.get(`${kind}:${id}`)?.row.sourceVersion ?? null;
      const candidateIdentity = {
        candidateContractVersion: 'actual-source-slice-v1',
        companyId: row.companyId,
        branchId: row.branchId,
        activationBoundaryId: row.activationBoundaryId,
        rentalLineId: row.rentalLineId,
        rentalId: row.rentalId,
        clientId: row.clientId,
        contractId: row.contractId ?? null,
        periodId: row.periodId,
        closedPeriodVersionId: row.closedPeriodVersionId,
        snapshotId: row.snapshotId,
        updId: row.updId,
        formedUpdVersionId: row.formedUpdVersionId,
        currentConductedUpdVersionId: row.currentConductedUpdVersionId,
        updLineId: row.updLineId,
        updLineVersionId: row.updLineVersionId,
        coverageSetId: row.coverageSetId,
        coverageSliceId: row.coverageSliceId,
        sliceStartDate: row.sliceStartDate,
        sliceEndDateExclusive: row.sliceEndDateExclusive,
        sourceNetMinor: Number(row.sourceNetMinor),
        sourceVatMinor: Number(row.sourceVatMinor),
        sourceGrossMinor: Number(row.sourceGrossMinor),
        currency: row.currency,
        contractualDueDate: row.contractualDueDate ?? null,
        dueDateProvenance: row.dueDateProvenance,
        dueDateEvidenceRef: row.dueDateEvidenceRef ?? null,
        closedPeriodVersion: inputVersion('billing_source_period_versions', row.closedPeriodVersionId),
        formedUpdVersion: inputVersion('billing_source_upd_versions', row.formedUpdVersionId),
        currentConductedUpdVersion: inputVersion(
          'billing_source_upd_versions',
          row.currentConductedUpdVersionId,
        ),
        updLineVersion: inputVersion('billing_source_upd_line_versions', row.updLineVersionId),
        coverageSetVersion: inputVersion('billing_source_coverage_sets', row.coverageSetId),
      };
      requireProof(pr8Fingerprint(candidateIdentity) === row.candidateKey, 'candidate_identity_hash');
      const selectedInputs = new Set([
        ['billing_source_activation_boundaries', row.activationBoundaryId],
        ['billing_source_rental_lines', row.rentalLineId],
        ['billing_source_periods', row.periodId],
        ['billing_source_period_versions', row.closedPeriodVersionId],
        ['billing_source_snapshots', row.snapshotId],
        ['billing_source_upds', row.updId],
        ['billing_source_upd_versions', row.formedUpdVersionId],
        ['billing_source_upd_versions', row.currentConductedUpdVersionId],
        ['billing_source_upd_lines', row.updLineId],
        ['billing_source_upd_line_versions', row.updLineVersionId],
        ['billing_source_coverage_sets', row.coverageSetId],
        ['billing_source_coverage_slices', row.coverageSliceId],
      ].map(([kind, id]) => inputByIdentity.get(`${kind}:${id}`)).filter(Boolean));
      const sourceSnapshot = db.prepare(`
        SELECT effectiveTermsVersionId FROM billing_source_snapshots WHERE id = ?
      `).get(row.snapshotId);
      if (sourceSnapshot?.effectiveTermsVersionId) {
        const terms = inputByIdentity.get(
          `billing_source_effective_terms:${sourceSnapshot.effectiveTermsVersionId}`,
        );
        if (terms) selectedInputs.add(terms);
      }
      for (const input of persistedInputs) {
        if (
          input.row.sourceKind === 'billing_source_snapshot_evidence'
          && input.relationships.snapshotId === row.snapshotId
        ) selectedInputs.add(input);
        if (
          input.row.sourceKind === 'billing_source_coverage_supersessions'
          && (
            input.relationships.originalCoverageSetId === row.coverageSetId
            || input.relationships.replacementCoverageSetId === row.coverageSetId
          )
        ) selectedInputs.add(input);
      }
      const operationIds = new Set([...selectedInputs]
        .map(input => input.relationships.operationId)
        .filter(Boolean));
      for (const operationId of operationIds) {
        const operation = inputByIdentity.get(`billing_source_operations:${operationId}`);
        if (operation) selectedInputs.add(operation);
      }
      for (const input of persistedInputs) {
        if (
          input.row.sourceKind === 'billing_source_audit_events'
          && operationIds.has(input.relationships.operationId)
        ) selectedInputs.add(input);
      }
      const reconstructedInputLineageHash = pr8Fingerprint([...selectedInputs]
        .map(input => ({
          sourceKind: input.row.sourceKind,
          sourceId: input.row.sourceId,
          normalizedInputHash: input.row.normalizedInputHash,
        }))
        .sort((left, right) => compareUtf16Ascending(pr8StableJson(left), pr8StableJson(right))));
      requireProof(reconstructedInputLineageHash === row.inputLineageHash, 'candidate_input_lineage_hash');
      return { row, blockerCodes, recomputedHash };
    });
    for (let index = 1; index < persistedCandidates.length; index += 1) {
      requireProof(
        compareUtf16Ascending(
          persistedCandidates[index - 1].row.candidateKey,
          persistedCandidates[index].row.candidateKey,
        ) < 0,
        'candidate_order',
      );
    }
    const resolveCandidateKey = candidateId => candidateId == null
      ? null
      : candidateKeysById.get(candidateId);
    const persistedChecks = checkRows.map(row => {
      const candidateKey = resolveCandidateKey(row.candidateId);
      requireProof(row.candidateId == null || Boolean(candidateKey), 'check_candidate_membership');
      const refs = parsePr8CanonicalJson(row.sourceEvidenceRefsJson, 'sourceEvidenceRefsJson', 'array');
      const canonical = pr8CheckCanonical(row, candidateKey, refs);
      requireProof(pr8Fingerprint(canonical) === row.checkHash, 'check_hash');
      return { ...canonical, checkHash: row.checkHash, candidateId: row.candidateId };
    }).sort((left, right) => compareUtf16Ascending(
      `${left.candidateKey}:${left.gateCode}`,
      `${right.candidateKey}:${right.gateCode}`,
    ));
    requireProof(
      new Set(persistedChecks.map(row => `${row.candidateId ?? 'run'}:${row.gateCode}`)).size
        === persistedChecks.length,
      'check_duplicate',
    );
    const selectedDueDateChecks = persistedChecks.filter(row => (
      row.candidateId === candidate.id && row.gateCode === 'contractual_due_date_evidence'
    ));
    if (candidate.dueDateProvenance === 'unknown') {
      requireProof(candidate.dueDateEvidenceRef === null, 'due_date_unknown_binding');
    } else {
      requireProof(
        selectedDueDateChecks.length === 1
        && canonicalJson(selectedDueDateChecks[0].sourceEvidenceRefs)
          === canonicalJson([candidate.dueDateEvidenceRef]),
        'due_date_evidence_binding',
      );
    }

    const dimensionKinds = [
      'closed_period_snapshot_aggregate',
      'coverage_set_delta',
      'coverage_slice_equation',
      'snapshot_equation',
      'upd_line_aggregate',
      'upd_line_equation',
    ];
    const persistedReconciliations = reconciliationRows.map(row => {
      const candidateKey = resolveCandidateKey(row.candidateId);
      requireProof(Boolean(candidateKey), 'reconciliation_candidate_membership');
      const dimensionIds = parsePr8CanonicalJson(row.dimensionIdsJson, 'dimensionIdsJson', 'object');
      const canonical = pr8ReconciliationCanonical(row, candidateKey, dimensionIds);
      requireProof(pr8Fingerprint(canonical) === row.reconciliationHash, 'reconciliation_hash');
      requireProof(
        Number(row.deltaNetMinor) === 0
        && Number(row.deltaVatMinor) === 0
        && Number(row.deltaGrossMinor) === 0
        && Number(row.blockerState) === 0,
        'reconciliation_delta',
      );
      return { ...canonical, reconciliationHash: row.reconciliationHash, candidateId: row.candidateId };
    }).sort((left, right) => compareUtf16Ascending(left.reconciliationHash, right.reconciliationHash));
    const reconciliationMembership = persistedReconciliations.map(row => (
      `${row.candidateId}:${row.dimensionKind}:${pr8StableJson(row.dimensionIds)}`
    ));
    requireProof(new Set(reconciliationMembership).size === reconciliationMembership.length, 'reconciliation_duplicate');
    requireProof(new Set(persistedReconciliations.map(row => row.reconciliationHash)).size === persistedReconciliations.length, 'reconciliation_hash_duplicate');
    for (const candidateRow of candidateRows) {
      const kinds = persistedReconciliations
        .filter(row => row.candidateId === candidateRow.id)
        .map(row => row.dimensionKind)
        .sort(compareUtf16Ascending);
      requireProof(canonicalJson(kinds) === canonicalJson(dimensionKinds), 'reconciliation_dimensions');
    }
    reconstructedReconciliationSetHash = sha256Canonical({
      domain: 'rentcore.canonical_actual_posting.pr8_reconciliation_set',
      dryRunId: run.id,
      reconciliationHashes: persistedReconciliations.map(row => row.reconciliationHash),
      version: 1,
    });

    const persistedDiagnostics = diagnosticRows.map(row => {
      const candidateKey = resolveCandidateKey(row.candidateId);
      requireProof(row.candidateId == null || Boolean(candidateKey), 'diagnostic_candidate_membership');
      const expectedEvidence = parsePr8CanonicalJson(row.expectedEvidenceJson, 'expectedEvidenceJson', 'object');
      const observedEvidence = parsePr8CanonicalJson(row.observedEvidenceJson, 'observedEvidenceJson', 'object');
      const policyReferences = parsePr8CanonicalJson(row.policyReferencesJson, 'policyReferencesJson', 'array');
      const canonical = pr8DiagnosticCanonical(
        row,
        candidateKey,
        expectedEvidence,
        observedEvidence,
        policyReferences,
      );
      requireProof(pr8Fingerprint(canonical) === row.diagnosticHash, 'diagnostic_hash');
      return { ...canonical, diagnosticHash: row.diagnosticHash };
    }).sort((left, right) => compareUtf16Ascending(
      `${left.candidateKey || ''}:${left.diagnosticHash}`,
      `${right.candidateKey || ''}:${right.diagnosticHash}`,
    ));
    requireProof(new Set(persistedDiagnostics.map(row => `${row.candidateKey || ''}:${row.diagnosticHash}`)).size === persistedDiagnostics.length, 'diagnostic_duplicate');

    const counts = {
      sourceInputCount: inputRows.length,
      candidateCount: candidateRows.length,
      checkCount: persistedChecks.length,
      reconciliationCount: persistedReconciliations.length,
      diagnosticCount: persistedDiagnostics.length,
      eligibleCandidateCount: candidateRows.filter(row => row.status === 'eligible_candidate').length,
      blockedCandidateCount: candidateRows.filter(row => row.status === 'blocked').length,
    };
    const totals = rows => ({
      netMinor: pr8SafeAdd(rows.map(row => Number(row.sourceNetMinor)), 'netMinor'),
      vatMinor: pr8SafeAdd(rows.map(row => Number(row.sourceVatMinor)), 'vatMinor'),
      grossMinor: pr8SafeAdd(rows.map(row => Number(row.sourceGrossMinor)), 'grossMinor'),
    });
    const runTotals = totals(candidateRows);
    const eligibleTotals = totals(candidateRows.filter(row => row.status === 'eligible_candidate'));
    const status = candidateRows.length === 0
      ? 'completed_no_candidates'
      : (counts.blockedCandidateCount > 0 || persistedDiagnostics.some(row => row.severity === 'blocking')
        ? 'completed_with_blockers'
        : 'completed');
    const resultCanonical = {
      resultContractVersion: 'actual-source-dry-run-result-v1',
      policyManifestHash: run.policyManifestHash,
      sourceInputManifestHash: run.sourceInputManifestHash,
      status,
      counts,
      runTotals,
      eligibleTotals,
      candidateResults: persistedCandidates.map(item => ({
        candidateKey: item.row.candidateKey,
        resultHash: item.recomputedHash,
      })),
      checkHashes: persistedChecks.map(item => item.checkHash),
      reconciliationHashes: persistedReconciliations.map(item => item.reconciliationHash),
      diagnosticHashes: persistedDiagnostics.map(item => item.diagnosticHash),
      diagnosticOnly: true,
      canonicalWriteAuthorized: false,
      productionActivationAuthorized: false,
    };
    reconstructedResultHash = pr8Fingerprint(resultCanonical);
    requireProof(reconstructedResultHash === run.resultHash, 'result_hash');
    requireProof(
      Number(run.sourceInputCount) === counts.sourceInputCount
      && Number(run.candidateCount) === counts.candidateCount
      && Number(run.checkCount) === counts.checkCount
      && Number(run.reconciliationCount) === counts.reconciliationCount
      && Number(run.diagnosticCount) === counts.diagnosticCount
      && Number(run.eligibleCandidateCount) === counts.eligibleCandidateCount
      && Number(run.blockedCandidateCount) === counts.blockedCandidateCount,
      'run_counts',
    );
    requireProof(
      Number(run.runNetMinor) === runTotals.netMinor
      && Number(run.runVatMinor) === runTotals.vatMinor
      && Number(run.runGrossMinor) === runTotals.grossMinor
      && Number(run.eligibleCandidateNetMinor) === eligibleTotals.netMinor
      && Number(run.eligibleCandidateVatMinor) === eligibleTotals.vatMinor
      && Number(run.eligibleCandidateGrossMinor) === eligibleTotals.grossMinor,
      'run_totals',
    );
    requireProof(
      run.status === 'completed'
      && status === 'completed'
      && Number(run.candidateCount) > 0
      && Number(run.blockedCandidateCount) === 0
      && candidate.status === 'eligible_candidate'
      && parsePr8CanonicalJson(candidate.blockerCodesJson, 'candidate.blockerCodesJson', 'array').length === 0
      && Number(run.diagnosticOnly) === 1
      && Number(run.canonicalWriteAuthorized) === 0
      && Number(run.productionActivationAuthorized) === 0
      && Number(candidate.diagnosticOnly) === 1
      && Number(candidate.canonicalWriteAuthorized) === 0
      && Number(candidate.productionActivationAuthorized) === 0,
      'accepted_status',
    );
    requireProof(reconciliationRows.length === candidateRows.length * 6, 'reconciliation_count');

    requireProof(operationRows.length === 1 && auditRows.length === 1, 'seal_cardinality');
    const operation = operationRows[0];
    const audit = auditRows[0];
    if (operation && audit) {
      const reconstructedCommandFingerprint = pr8Fingerprint({
        operationType: 'evaluate_actual_source_dry_run',
        companyId: run.companyId,
        branchId: run.branchId,
        principalId: operation.actorPrincipalId,
        membershipId: operation.actorMembershipId,
        membershipVersion: Number(operation.actorMembershipVersion),
        roleTemplateKey: operation.roleTemplateKey,
        roleTemplateVersion: Number(operation.roleTemplateVersion),
        capabilityCatalogVersion: Number(operation.capabilityCatalogVersion),
        capabilityKey: operation.capabilityKey,
        asOfDate: run.asOfDate,
        idempotencyKey: operation.idempotencyKey,
        correlationId: run.correlationId,
        policyManifestHash: run.policyManifestHash,
        sourceInputManifestHash: run.sourceInputManifestHash,
        reasonCode: audit.reasonCode,
        reasonText: audit.reasonText,
        evaluatorVersion: run.evaluatorVersion,
      });
      requireProof(
        run.operationId === operation.id
        && operation.operationType === 'evaluate_actual_source_dry_run'
        && operation.commandFingerprint === reconstructedCommandFingerprint
        && operation.resultRunId === run.id
        && operation.resultHash === run.resultHash
        && operation.auditEventId === audit.id
        && operation.policyManifestHash === run.policyManifestHash
        && operation.inputSetHash === run.sourceInputManifestHash
        && operation.correlationId === run.correlationId
        && operation.createdAt === run.createdAt
        && operation.capabilityKey === 'receivables.read'
        && Number(operation.schemaVersion) === 1,
        'operation_seal',
      );
      requireProof(
        audit.aggregateType === 'actual_source_dry_run'
        && audit.aggregateId === run.id
        && Number(audit.aggregateVersion) === 1
        && audit.eventType === 'actual_source_dry_run_evaluated'
        && audit.actorType === 'user'
        && audit.actorPrincipalId === operation.actorPrincipalId
        && audit.actorMembershipId === operation.actorMembershipId
        && Number(audit.actorMembershipVersion) === Number(operation.actorMembershipVersion)
        && audit.roleTemplateKey === operation.roleTemplateKey
        && Number(audit.roleTemplateVersion) === Number(operation.roleTemplateVersion)
        && Number(audit.capabilityCatalogVersion) === Number(operation.capabilityCatalogVersion)
        && audit.capabilityKey === operation.capabilityKey
        && audit.operationId === operation.id
        && audit.correlationId === run.correlationId
        && audit.inputSetHash === run.sourceInputManifestHash
        && audit.resultHash === run.resultHash
        && audit.afterFingerprint === run.resultHash
        && audit.beforeFingerprint === null
        && Number(audit.inputCount) === counts.sourceInputCount
        && Number(audit.candidateCount) === counts.candidateCount
        && Number(audit.checkCount) === counts.checkCount
        && Number(audit.reconciliationCount) === counts.reconciliationCount
        && Number(audit.diagnosticCount) === counts.diagnosticCount
        && audit.createdAt === run.createdAt
        && Number(audit.schemaVersion) === 1,
        'audit_seal',
      );
    }
    requireProof(run.finalizedAt === run.createdAt, 'run_finalize_seal');
  } catch (error) {
    reasons.push(`graph:${error?.code || error?.message || 'invalid'}`);
  }

  try {
    requireProof(computeAcceptedDryRunsHash(acceptedDryRuns) === authorization.acceptedDryRunsHash, 'accepted_pairs_hash');
    requireProof(acceptedPair?.resultHash === run?.resultHash, 'accepted_pair');
    requireProof(Boolean(acceptedRun), 'accepted_run_missing');
    if (acceptedRun) {
      const finalizedAt = parseUtcMilliseconds(acceptedRun.finalizedAt);
      const validFrom = parseUtcMilliseconds(acceptedRun.validFrom);
      const validUntil = parseUtcMilliseconds(acceptedRun.validUntilExclusive);
      const policyHash = sha256Canonical({
        domain: 'rentcore.canonical_actual_posting.pr8_freshness_policy',
        durationMs: 900000,
        intervalKind: 'half_open',
        policyId: 'rentcore.pr8_evidence_freshness.v1',
        policyVersion: 1,
        version: 1,
      });
      const windowHash = sha256Canonical({
        domain: 'rentcore.canonical_actual_posting.pr8_freshness_window',
        finalizedAt: acceptedRun.finalizedAt,
        freshnessDurationMs: acceptedRun.freshnessDurationMs,
        freshnessPolicyHash: acceptedRun.freshnessPolicyHash,
        freshnessPolicyId: acceptedRun.freshnessPolicyId,
        freshnessPolicyVersion: acceptedRun.freshnessPolicyVersion,
        validFrom: acceptedRun.validFrom,
        validUntilExclusive: acceptedRun.validUntilExclusive,
        version: 1,
      });
      requireProof(
        acceptedRun.freshnessDurationMs === 900000
        && acceptedRun.freshnessPolicyId === 'rentcore.pr8_evidence_freshness.v1'
        && acceptedRun.freshnessPolicyVersion === 1
        && acceptedRun.freshnessPolicyHash === policyHash
        && acceptedRun.freshnessWindowFingerprint === windowHash
        && validFrom === finalizedAt
        && validUntil === finalizedAt + 900000
        && run?.finalizedAt === acceptedRun.finalizedAt,
        'freshness_window',
      );
      observedFreshnessWindowFingerprint = windowHash;
      freshnessState = attemptedAt < validFrom
        ? 'not_yet_valid'
        : attemptedAt >= validUntil ? 'stale' : 'fresh';
      requireProof(freshnessState === 'fresh', 'freshness_state');
      requireProof(
        acceptedRun.resultHash === run?.resultHash
        && acceptedRun.policyManifestHash === run?.policyManifestHash
        && acceptedRun.sourceInputManifestHash === run?.sourceInputManifestHash
        && acceptedRun.reconciliationSetHash === reconstructedReconciliationSetHash
        && acceptedRun.companyTimezoneSnapshot === run?.companyTimezone
        && acceptedRun.companyTimezoneSnapshot === authorization.acceptedCompanyTimezoneSnapshot
        && acceptedRun.companyTimezoneSnapshot === activation.companyTimezoneSnapshot
        && acceptedRun.sourceOwnershipManifestHash === authorization.sourceOwnershipManifestHash,
        'accepted_run_binding',
      );
    }
    if (validateCompleteAcceptanceSet) {
      const orderedAcceptedRuns = [...acceptedRuns].sort((left, right) => (
        compareUtf16Ascending(left.dryRunId, right.dryRunId)
      ));
      const pairProjection = orderedAcceptedRuns.map(entry => ({
        dryRunId: entry.dryRunId,
        resultHash: entry.resultHash,
      }));
      requireProof(
        authorization.acceptedPr8EvidenceJson === canonicalJson(orderedAcceptedRuns),
        'accepted_runs_order',
      );
      requireProof(
        authorization.acceptedDryRunsJson === canonicalJson(pairProjection),
        'accepted_pair_projection',
      );
      requireProof(
        canonicalJson(acceptedDryRuns) === canonicalJson(pairProjection),
        'accepted_pair_membership',
      );
      const acceptedTimezones = new Set(orderedAcceptedRuns.map(entry => entry.companyTimezoneSnapshot));
      const acceptedOwnershipHashes = new Set(
        orderedAcceptedRuns.map(entry => entry.sourceOwnershipManifestHash),
      );
      requireProof(
        acceptedTimezones.size === 1
        && acceptedTimezones.has(authorization.acceptedCompanyTimezoneSnapshot),
        'accepted_timezone_set',
      );
      requireProof(
        acceptedOwnershipHashes.size === 1
        && acceptedOwnershipHashes.has(authorization.sourceOwnershipManifestHash),
        'accepted_ownership_set',
      );
      for (const entry of orderedAcceptedRuns) {
        const persistedRun = db.prepare(`
          SELECT * FROM ${ACTUAL_SOURCE_DRY_RUNS_TABLE} WHERE id = ?
        `).get(entry.dryRunId);
        const persistedCandidate = persistedRun ? db.prepare(`
          SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE}
          WHERE runId = ? ORDER BY candidateKey ASC, id ASC LIMIT 1
        `).get(entry.dryRunId) : null;
        if (!persistedRun || !persistedCandidate) {
          requireProof(false, `accepted_run_persisted_graph:${entry.dryRunId}`);
          continue;
        }
        const entryProof = verifyPr8EvidenceGraph(
          db,
          {
            ...command,
            candidateId: persistedCandidate.id,
            dryRunId: persistedRun.id,
          },
          authorization,
          activation,
          deniedAttemptedAt,
          { validateCompleteAcceptanceSet: false },
        );
        requireProof(entryProof.valid, `accepted_run_complete_graph:${entry.dryRunId}`);
      }
    }
    const acceptedFreshnessWindowsHash = sha256Canonical({
      domain: 'rentcore.canonical_actual_posting.accepted_freshness_windows',
      windows: acceptedRuns.map(entry => ({
        dryRunId: entry.dryRunId,
        freshnessWindowFingerprint: entry.freshnessWindowFingerprint,
      })),
      version: 1,
    });
    requireProof(acceptedFreshnessWindowsHash === authorization.acceptedFreshnessWindowsHash, 'accepted_freshness_hash');
    requireProof(
      computeAcceptedPr8EvidenceHash({
        acceptedDryRunsHash: authorization.acceptedDryRunsHash,
        acceptedFreshnessWindowsHash: authorization.acceptedFreshnessWindowsHash,
        acceptedRuns,
        evidencePackHash: authorization.evidencePackHash,
      }) === authorization.acceptedPr8EvidenceHash,
      'accepted_evidence_hash',
    );
    requireProof(
      activation.acceptedDryRunsHash === authorization.acceptedDryRunsHash
      && activation.acceptedPr8EvidenceHash === authorization.acceptedPr8EvidenceHash
      && activation.acceptedFreshnessWindowsHash === authorization.acceptedFreshnessWindowsHash,
      'activation_evidence_binding',
    );
  } catch (error) {
    freshnessState = 'invalid_window';
    reasons.push(`acceptance:${error?.code || error?.message || 'invalid'}`);
  }

  if (reasons.length > 0 && freshnessState === 'fresh') freshnessState = 'invalid_window';
  const expectedFreshnessFingerprint = acceptedRun?.freshnessWindowFingerprint ?? null;
  const expectedProjection = {
    acceptedDryRunsHash: authorization.acceptedDryRunsHash,
    acceptedPr8EvidenceHash: authorization.acceptedPr8EvidenceHash,
    deniedFreshnessWindowFingerprint: expectedFreshnessFingerprint === null ? null : deniedFreshnessWindowFingerprint({
      deniedAttemptedAt,
      freshnessState: 'fresh',
      freshnessWindowFingerprint: expectedFreshnessFingerprint,
    }),
    dryRunId: command.dryRunId,
    freshnessState: 'fresh',
    freshnessWindowFingerprint: expectedFreshnessFingerprint,
    reconciliationSetHash: acceptedRun?.reconciliationSetHash ?? null,
    resultHash: acceptedRun?.resultHash ?? acceptedPair?.resultHash ?? null,
  };
  const observedDryRunsHash = observedAcceptedDryRunsHash(acceptedDryRuns);
  const observedFreshnessWindowsHash = observedAcceptedFreshnessWindowsHash(acceptedRuns);
  const observedProjection = {
    acceptedDryRunsHash: observedDryRunsHash,
    acceptedPr8EvidenceHash: observedAcceptedPr8EvidenceHash({
      acceptedDryRunsHash: observedDryRunsHash,
      acceptedFreshnessWindowsHash: observedFreshnessWindowsHash,
      acceptedRuns,
      evidencePackHash: authorization.evidencePackHash,
    }),
    deniedFreshnessWindowFingerprint: observedFreshnessWindowFingerprint === null ? null : deniedFreshnessWindowFingerprint({
      deniedAttemptedAt,
      freshnessState,
      freshnessWindowFingerprint: observedFreshnessWindowFingerprint,
    }),
    dryRunId: run?.id ?? command.dryRunId,
    freshnessState,
    freshnessWindowFingerprint: observedFreshnessWindowFingerprint,
    reconciliationSetHash: reconstructedReconciliationSetHash,
    resultHash: reconstructedResultHash,
  };
  if (validateCompleteAcceptanceSet) {
    requireProof(canonicalJson(expectedProjection) === canonicalJson(observedProjection), 'projection_mismatch');
  }
  return Object.freeze({
    acceptedRun,
    candidate,
    expectedProjection: materializeInert(expectedProjection),
    observedProjection: materializeInert(observedProjection),
    reasons: Object.freeze(reasons),
    run,
    valid: reasons.length === 0,
  });
}

function temporalWindowFingerprint(record, recordKind, deniedAttemptedAt) {
  return sha256Canonical({
    deniedAttemptedAt,
    domain: 'rentcore.canonical_actual_posting.temporal_window',
    effectiveFrom: record.effectiveFrom,
    effectiveUntil: record.expiresAt,
    recordHash: record.recordHash,
    recordId: record.recordId,
    recordKind,
    version: 1,
  });
}

function temporalDenialProjection(record, recordKind, deniedAttemptedAt, expected) {
  const state = temporalState(record, parseUtcMilliseconds(deniedAttemptedAt));
  const idKey = recordKind === 'activation' ? 'activationId' : 'authorizationId';
  const stateKey = recordKind === 'activation' ? 'activationTemporalState' : 'authorizationTemporalState';
  const versionKey = recordKind === 'activation' ? 'activationVersion' : 'authorizationVersion';
  return {
    [idKey]: record[idKey],
    [stateKey]: expected ? 'active' : state,
    [versionKey]: Number(record[versionKey]),
    recordHash: record.recordHash,
    status: expected ? 'authorized' : record.status,
    temporalWindowFingerprint: temporalWindowFingerprint(record, recordKind, deniedAttemptedAt),
    validFrom: record.effectiveFrom,
    validUntil: record.expiresAt,
  };
}

function reconstructMissingPr8Candidate(db, command, run, acceptedRun, activation) {
  const reconciliationRows = db.prepare(`
    SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE}
    WHERE runId = ? AND candidateId = ? AND companyId = ? AND branchId = ?
      AND dimensionKind = 'coverage_slice_equation'
    ORDER BY id ASC
  `).all(command.dryRunId, command.candidateId, command.companyId, command.branchId);
  const coverageSliceIds = [...new Set(reconciliationRows.map(row => {
    try {
      return parsePr8CanonicalJson(row.dimensionIdsJson, 'dimensionIdsJson', 'object').coverageSliceId;
    } catch {
      return null;
    }
  }).filter(Boolean))].sort(compareUtf16Ascending);
  if (coverageSliceIds.length !== 1) return null;
  const slice = db.prepare(`
    SELECT * FROM ${BILLING_SOURCE_COVERAGE_SLICES_TABLE}
    WHERE id = ? AND companyId = ? AND branchId = ?
  `).get(coverageSliceIds[0], command.companyId, command.branchId);
  if (!slice) return null;
  const conductedVersions = db.prepare(`
    SELECT * FROM ${BILLING_SOURCE_UPD_VERSIONS_TABLE}
    WHERE companyId = ? AND branchId = ? AND updId = ?
      AND formedVersionId = ? AND state = 'conducted'
    ORDER BY version DESC, id ASC
  `).all(command.companyId, command.branchId, slice.updId, slice.formedUpdVersionId);
  if (conductedVersions.length !== 1) return null;
  const inputRows = db.prepare(`
    SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_INPUTS_TABLE}
    WHERE runId = ? AND companyId = ? AND branchId = ?
    ORDER BY deterministicOrderKey ASC, id ASC
  `).all(command.dryRunId, command.companyId, command.branchId);
  const persistedInputs = inputRows.map(row => ({
    row,
    relationships: parsePr8CanonicalJson(row.relationshipJson, 'relationshipJson', 'object'),
  }));
  const inputByIdentity = new Map(persistedInputs.map(input => [
    `${input.row.sourceKind}:${input.row.sourceId}`,
    input,
  ]));
  const sliceInput = inputByIdentity.get(`billing_source_coverage_slices:${slice.id}`);
  const canonicalSlice = Object.fromEntries(Object.entries(slice).sort(([left], [right]) => (
    compareUtf16Ascending(left, right)
  )));
  if (
    !sliceInput
    || sliceInput.row.coverageSliceId !== slice.id
    || sliceInput.row.normalizedInputHash !== pr8Fingerprint({
      sourceKind: 'billing_source_coverage_slices',
      row: canonicalSlice,
    })
  ) return null;
  const inputVersion = (kind, id) => inputByIdentity.get(`${kind}:${id}`)?.row.sourceVersion ?? null;
  const currentConducted = conductedVersions[0];
  const candidateIdentity = {
    candidateContractVersion: 'actual-source-slice-v1',
    companyId: command.companyId,
    branchId: command.branchId,
    activationBoundaryId: activation.activationBoundaryId,
    rentalLineId: slice.rentalLineId,
    rentalId: slice.rentalId,
    clientId: slice.clientId,
    contractId: slice.contractId ?? null,
    periodId: slice.periodId,
    closedPeriodVersionId: slice.closedPeriodVersionId,
    snapshotId: slice.snapshotId,
    updId: slice.updId,
    formedUpdVersionId: slice.formedUpdVersionId,
    currentConductedUpdVersionId: currentConducted.id,
    updLineId: slice.updLineId,
    updLineVersionId: slice.updLineVersionId,
    coverageSetId: slice.coverageSetId,
    coverageSliceId: slice.id,
    sliceStartDate: slice.sliceStartDate,
    sliceEndDateExclusive: slice.sliceEndDateExclusive,
    sourceNetMinor: Number(slice.allocatedNetMinor),
    sourceVatMinor: Number(slice.allocatedVatMinor),
    sourceGrossMinor: Number(slice.allocatedGrossMinor),
    currency: slice.currency,
    contractualDueDate: slice.contractualDueDate ?? null,
    dueDateProvenance: slice.dueDateProvenance,
    dueDateEvidenceRef: slice.dueDateEvidenceRef ?? null,
    closedPeriodVersion: inputVersion('billing_source_period_versions', slice.closedPeriodVersionId),
    formedUpdVersion: inputVersion('billing_source_upd_versions', slice.formedUpdVersionId),
    currentConductedUpdVersion: inputVersion('billing_source_upd_versions', currentConducted.id),
    updLineVersion: inputVersion('billing_source_upd_line_versions', slice.updLineVersionId),
    coverageSetVersion: inputVersion('billing_source_coverage_sets', slice.coverageSetId),
  };
  const selectedInputs = new Set([
    ['billing_source_activation_boundaries', activation.activationBoundaryId],
    ['billing_source_rental_lines', slice.rentalLineId],
    ['billing_source_periods', slice.periodId],
    ['billing_source_period_versions', slice.closedPeriodVersionId],
    ['billing_source_snapshots', slice.snapshotId],
    ['billing_source_upds', slice.updId],
    ['billing_source_upd_versions', slice.formedUpdVersionId],
    ['billing_source_upd_versions', currentConducted.id],
    ['billing_source_upd_lines', slice.updLineId],
    ['billing_source_upd_line_versions', slice.updLineVersionId],
    ['billing_source_coverage_sets', slice.coverageSetId],
    ['billing_source_coverage_slices', slice.id],
  ].map(([kind, id]) => inputByIdentity.get(`${kind}:${id}`)).filter(Boolean));
  const snapshot = db.prepare(`
    SELECT effectiveTermsVersionId FROM ${BILLING_SOURCE_SNAPSHOTS_TABLE} WHERE id = ?
  `).get(slice.snapshotId);
  if (snapshot?.effectiveTermsVersionId) {
    const terms = inputByIdentity.get(`billing_source_effective_terms:${snapshot.effectiveTermsVersionId}`);
    if (terms) selectedInputs.add(terms);
  }
  for (const input of persistedInputs) {
    if (
      input.row.sourceKind === 'billing_source_snapshot_evidence'
      && input.relationships.snapshotId === slice.snapshotId
    ) selectedInputs.add(input);
    if (
      input.row.sourceKind === 'billing_source_coverage_supersessions'
      && (
        input.relationships.originalCoverageSetId === slice.coverageSetId
        || input.relationships.replacementCoverageSetId === slice.coverageSetId
      )
    ) selectedInputs.add(input);
  }
  const operationIds = new Set([...selectedInputs]
    .map(input => input.relationships.operationId)
    .filter(Boolean));
  for (const operationId of operationIds) {
    const operation = inputByIdentity.get(`billing_source_operations:${operationId}`);
    if (operation) selectedInputs.add(operation);
  }
  for (const input of persistedInputs) {
    if (
      input.row.sourceKind === 'billing_source_audit_events'
      && operationIds.has(input.relationships.operationId)
    ) selectedInputs.add(input);
  }
  const inputLineageHash = pr8Fingerprint([...selectedInputs].map(input => ({
    sourceKind: input.row.sourceKind,
    sourceId: input.row.sourceId,
    normalizedInputHash: input.row.normalizedInputHash,
  })).sort((left, right) => compareUtf16Ascending(pr8StableJson(left), pr8StableJson(right))));
  const policyManifestHash = run?.policyManifestHash ?? acceptedRun?.policyManifestHash ?? null;
  if (!policyManifestHash) return null;
  const candidate = {
    ...candidateIdentity,
    id: command.candidateId,
    runId: command.dryRunId,
    candidateKey: pr8Fingerprint(candidateIdentity),
    blockerCodesJson: '[]',
    proposedOriginalAmountMinor: Number(slice.allocatedGrossMinor),
    status: 'eligible_candidate',
    policyManifestHash,
    inputLineageHash,
    diagnosticOnly: 1,
    canonicalWriteAuthorized: 0,
    productionActivationAuthorized: 0,
  };
  candidate.resultHash = pr8Fingerprint(pr8CandidateResultCanonical(candidate, []));
  return Object.freeze(candidate);
}

function loadAcceptedContext(
  db,
  authorityRepository,
  command,
  attemptedAt,
  runtimeContract,
  { historicalAuthorityChains = null } = {},
) {
  const deniedAttemptedAt = renderUtcMilliseconds(attemptedAt);
  const requestedAuthorization = authorityRepository.readWriteAuthorizationRecord(
    command.writeAuthorizationRecordId,
  );
  const requestedActivation = authorityRepository.readActivationRecord(command.activationRecordId);
  const latestAuthorization = authorityRepository.readLatestWriteAuthorization(command);
  const latestActivation = authorityRepository.readLatestActivation(command);
  const authorization = requestedAuthorization || latestAuthorization;
  const activation = requestedActivation || latestActivation;
  if (!authorization || !activation) {
    throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
  }
  const pr8Proof = verifyPr8EvidenceGraph(
    db,
    command,
    authorization,
    activation,
    deniedAttemptedAt,
  );
  const { run: persistedRun, candidate: acceptedCandidate, acceptedRun } = pr8Proof;
  const run = persistedRun || (acceptedRun ? Object.freeze({
    id: command.dryRunId,
    companyId: command.companyId,
    branchId: command.branchId,
    companyTimezone: acceptedRun.companyTimezoneSnapshot,
    policyManifestHash: acceptedRun.policyManifestHash,
    resultHash: acceptedRun.resultHash,
    sourceInputManifestHash: acceptedRun.sourceInputManifestHash,
  }) : null);
  const sourceCandidate = acceptedCandidate || reconstructMissingPr8Candidate(
    db,
    command,
    run,
    acceptedRun,
    activation,
  );
  if (!run || !sourceCandidate) {
    throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
  }
  const sourceGraph = analyzeLockedSourceGraph(db, sourceCandidate);
  const candidate = sourceGraph.currentCandidate;

  const sourceAuthority = authorityRepository.readAuthorityRecord(authorization.sourceAdapterAuthorityRecordId);
  const producerAuthority = authorityRepository.readAuthorityRecord(authorization.producerAuthorityRecordId);
  const postingAuthority = authorityRepository.readAuthorityRecord(authorization.postingAdapterAuthorityRecordId);
  if (!sourceAuthority || !producerAuthority || !postingAuthority) {
    throw repositoryError(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  }
  if (
    sourceAuthority.authorityVersion !== authorization.sourceAdapterAuthorityVersion
    || sourceAuthority.recordHash !== authorization.sourceAdapterAuthorityRecordHash
    || producerAuthority.authorityVersion !== authorization.producerAuthorityVersion
    || producerAuthority.recordHash !== authorization.producerAuthorityRecordHash
    || postingAuthority.authorityVersion !== authorization.postingAdapterAuthorityVersion
    || postingAuthority.recordHash !== authorization.postingAdapterAuthorityRecordHash
    || producerAuthority.authorityKind !== 'eligibility_producer'
    || postingAuthority.authorityKind !== 'canonical_posting_adapter'
    || sourceAuthority.authorityKind !== 'source_adapter'
  ) throw repositoryError('CANONICAL_AUTHORITY_BINDING_INVALID');

  const authorityBindings = [
    { authority: sourceAuthority, authorityKind: 'source_adapter' },
    { authority: producerAuthority, authorityKind: 'eligibility_producer' },
    { authority: postingAuthority, authorityKind: 'canonical_posting_adapter' },
  ];
  const authorityStates = authorityBindings.map(({ authority, authorityKind }) => {
    const chain = historicalAuthorityChains?.get(authorityKind)
      || authorityRepository.readAuthorityChain(authority);
    const boundInChain = chain.find(row => row.recordId === authority.recordId);
    if (
      !boundInChain
      || boundInChain.recordHash !== authority.recordHash
      || boundInChain.authorityVersion !== authority.authorityVersion
    ) throw repositoryError(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
    const latest = chain[chain.length - 1];
    if (!latest) throw repositoryError(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
    if (latest.recordId !== authority.recordId && latest.status === 'expired') {
      throw repositoryError('AUTHORITY_LATEST_EXPIRED_DESCENDANT_UNREPRESENTABLE_V1');
    }
    const binding = {
      artifactDigest: runtimeContract.authorities[authorityKind].artifactDigest,
      branchId: command.branchId,
      companyId: command.companyId,
      configurationHash: runtimeContract.authorities[authorityKind].configurationHash,
      policyHash: runtimeContract.authorities[authorityKind].policyHash,
      recordHash: authority.recordHash,
      recordId: authority.recordId,
      sourceCommitSha: runtimeContract.authorities[authorityKind].sourceCommitSha,
      sourceOwnershipManifestHash: authorization.sourceOwnershipManifestHash,
    };
    const candidates = authorityRepository.buildAuthorityCandidates({
      chain,
      binding,
      attemptedAt: renderUtcMilliseconds(attemptedAt),
    });
    return Object.freeze({ authority, authorityKind, binding, candidates, chain, latest });
  });
  const authorityDenial = selectGlobalAuthorityDenial(authorityStates.map(state => ({
    authorityKind: state.authorityKind,
    candidates: state.candidates,
  })));

  const authorizationDrift = (
    !requestedAuthorization
    ||
    latestAuthorization.recordId !== authorization.recordId
    ||
    authorization.companyId !== command.companyId
    || authorization.branchId !== command.branchId
    || authorization.status !== 'authorized'
    || temporalState(authorization, attemptedAt) !== 'active'
  );
  const activationDrift = (
    !requestedActivation
    ||
    latestActivation.recordId !== activation.recordId
    ||
    activation.companyId !== command.companyId
    || activation.branchId !== command.branchId
    || activation.status !== 'authorized'
    || temporalState(activation, attemptedAt) !== 'active'
    || activation.writeAuthorizationRecordId !== authorization.recordId
    || activation.recordId !== command.activationRecordId
    || authorization.activationBoundaryId !== activation.activationBoundaryId
    || authorization.cohortHash !== activation.cohortHash
    || authorization.boundaryHash !== activation.boundaryHash
    || authorization.acceptedDryRunsHash !== activation.acceptedDryRunsHash
    || authorization.acceptedPr8EvidenceHash !== activation.acceptedPr8EvidenceHash
    || authorization.acceptedFreshnessWindowsHash !== activation.acceptedFreshnessWindowsHash
    || authorization.acceptedCompanyTimezoneSnapshot !== activation.companyTimezoneSnapshot
    || authorization.policyManifestHashesJson !== activation.policyManifestHashesJson
    || authorization.sourceSystemIdsJson !== activation.sourceSystemIdsJson
    || authorization.postingAdapterAuthorityRecordId !== activation.postingAdapterAuthorityRecordId
    || authorization.postingAdapterAuthorityVersion !== activation.postingAdapterAuthorityVersion
    || authorization.postingAdapterAuthorityRecordHash !== activation.postingAdapterAuthorityRecordHash
    || authorization.postingAdapterAuthorityCompanyId !== activation.postingAdapterAuthorityCompanyId
    || authorization.postingAdapterAuthorityBranchId !== activation.postingAdapterAuthorityBranchId
    || authorization.postingAdapterAuthorityKind !== activation.postingAdapterAuthorityKind
    || activation.boundaryEndUtc !== null
  );

  const company = db.prepare(`SELECT * FROM ${CANONICAL_COMPANIES_TABLE} WHERE id = ?`).get(command.companyId);
  const timezoneValues = {
    acceptedCompanyTimezoneSnapshot: authorization.acceptedCompanyTimezoneSnapshot ?? null,
    activationCompanyTimezoneSnapshot: activation.companyTimezoneSnapshot ?? null,
    eventCompanyTimezoneSnapshot: run?.companyTimezone ?? null,
    pr5ReceivablesTimezone: company?.receivablesTimezone ?? null,
    pr8RunCompanyTimezone: run?.companyTimezone ?? null,
  };
  const timezoneNonNull = Object.values(timezoneValues).filter(value => value !== null);
  const timezoneState = timezoneNonNull.length !== Object.keys(timezoneValues).length
    ? 'unavailable'
    : new Set(timezoneNonNull).size === 1 ? 'valid' : 'mismatch';
  const timezoneExpected = {
    ...timezoneValues,
    eventCompanyTimezoneSnapshot: authorization.acceptedCompanyTimezoneSnapshot,
    pr5ReceivablesTimezone: authorization.acceptedCompanyTimezoneSnapshot,
    pr8RunCompanyTimezone: authorization.acceptedCompanyTimezoneSnapshot,
    activationCompanyTimezoneSnapshot: authorization.acceptedCompanyTimezoneSnapshot,
    timezoneState: 'valid',
  };
  const timezoneObserved = { ...timezoneValues, timezoneState };

  const policyBinding = selectedRunPolicyBinding(run, command, candidate);
  let dueDatePolicySet = null;
  let selectedDueDate = null;
  let dueDateState = 'missing';
  try {
    dueDatePolicySet = parseCanonicalJson(authorization.dueDatePolicySetJson, 'dueDatePolicySetJson');
    const selectedRunDueDatePolicySet = policyBinding.dueDatePolicySet;
    selectedDueDate = candidate.dueDateProvenance === 'unknown'
      ? selectedRunDueDatePolicySet?.unknownDueDateTreatment
      : selectedRunDueDatePolicySet?.contractualDueDate;
    if (!selectedDueDate) {
      selectedDueDate = candidate.dueDateProvenance === 'unknown'
        ? dueDatePolicySet.unknownDueDateTreatment
        : dueDatePolicySet.contractualDueDate;
    }
    dueDateState = (
      policyBinding.dueDatePoliciesValid
      && canonicalJson(dueDatePolicySet) === canonicalJson(selectedRunDueDatePolicySet)
      && computeDueDatePolicySetHash(selectedRunDueDatePolicySet) === authorization.dueDatePolicySetHash
      && activation.dueDatePolicySetHash === authorization.dueDatePolicySetHash
      && activation.dueDatePolicySetJson === authorization.dueDatePolicySetJson
      && (candidate.dueDateProvenance === 'unknown'
        || selectedDueDate.expectedSourceRef === candidate.dueDateProvenance)
    ) ? 'valid' : 'ambiguous';
  } catch {
    dueDateState = 'ambiguous';
  }
  const dueDateSpecific = state => ({
    bindingState: state,
    dueDatePolicySetHash: state === 'valid'
      ? computeDueDatePolicySetHash(policyBinding.dueDatePolicySet || dueDatePolicySet)
      : null,
    dueDateTreatment: state === 'valid'
      ? (candidate.dueDateProvenance === 'unknown' ? 'post_without_aging_v1' : 'proven_contractual_date_v1')
      : null,
    selectedDueDateGateKind: state === 'valid' ? selectedDueDate.gateKind : null,
    selectedDueDatePolicyHash: state === 'valid' ? selectedDueDate.policyHash : null,
    selectedDueDatePolicyId: state === 'valid' ? selectedDueDate.policyId : null,
    selectedDueDatePolicyVersion: state === 'valid' ? selectedDueDate.policyVersion : null,
    unknownDueDateTreatmentMappingHash: state === 'valid' && candidate.dueDateProvenance === 'unknown'
      ? selectedDueDate.mappingHash : null,
    unknownDueDateTreatmentMappingId: state === 'valid' && candidate.dueDateProvenance === 'unknown'
      ? selectedDueDate.mappingId : null,
    unknownDueDateTreatmentMappingVersion: state === 'valid' && candidate.dueDateProvenance === 'unknown'
      ? selectedDueDate.mappingVersion : null,
  });

  let nonAuthorityDenial = null;
  if (authorizationDrift) {
    const expected = temporalDenialProjection(
      authorization,
      'write_authorization',
      deniedAttemptedAt,
      true,
    );
    if (!requestedAuthorization) expected.authorizationId = command.writeAuthorizationRecordId;
    nonAuthorityDenial = {
      conflictType: 'AUTHORIZATION_DRIFT',
      expectedSpecific: expected,
      observedSpecific: temporalDenialProjection(
        latestAuthorization,
        'write_authorization',
        deniedAttemptedAt,
        false,
      ),
    };
  } else if (activationDrift) {
    const expected = temporalDenialProjection(activation, 'activation', deniedAttemptedAt, true);
    if (!requestedActivation) expected.activationId = command.activationRecordId;
    nonAuthorityDenial = {
      conflictType: 'ACTIVATION_DRIFT',
      expectedSpecific: expected,
      observedSpecific: temporalDenialProjection(latestActivation, 'activation', deniedAttemptedAt, false),
    };
  } else if (!pr8Proof.valid) {
    nonAuthorityDenial = {
      conflictType: 'PR8_EVIDENCE_MISMATCH',
      expectedSpecific: pr8Proof.expectedProjection,
      observedSpecific: pr8Proof.observedProjection,
    };
  } else if (sourceGraph.denial) {
    nonAuthorityDenial = sourceGraph.denial;
  } else if (dueDateState !== 'valid') {
    nonAuthorityDenial = {
      conflictType: 'DUE_DATE_POLICY_DRIFT',
      expectedSpecific: dueDateSpecific('valid'),
      observedSpecific: dueDateSpecific(dueDateState),
    };
  } else if (timezoneState !== 'valid') {
    nonAuthorityDenial = {
      conflictType: 'COMPANY_TIMEZONE_DRIFT',
      expectedSpecific: timezoneExpected,
      observedSpecific: timezoneObserved,
    };
  }

  const amountBasisGate = policyBinding.amountBasisGate;
  const amountBasisValid = (
    policyBinding.amountBasisValid
    && authorization.amountBasisPolicyRef === amountBasisGate?.decisionRef
    && authorization.amountBasisPolicyHash === amountBasisGate?.decisionHash
    && Number(candidate.proposedOriginalAmountMinor) === Number(candidate.sourceGrossMinor)
  );

  return Object.freeze({
    acceptedRun,
    acceptedCandidate,
    activation,
    authorization,
    candidate,
    dueDatePolicySet,
    postingAuthority,
    producerAuthority,
    run,
    selectedDueDate,
    sourceAuthority,
    authorityDenial,
    authorityStates: Object.freeze(authorityStates),
    nonAuthorityDenial: nonAuthorityDenial ? Object.freeze(nonAuthorityDenial) : null,
    operationalFailureCode: amountBasisValid
      ? null
      : 'CANONICAL_WRITE_AUTHORIZATION_INTEGRITY_FAILED',
    pr8Proof,
    runtimeContract,
    sourceGraph,
    requestedActivationRecordId: command.activationRecordId,
    requestedWriteAuthorizationRecordId: command.writeAuthorizationRecordId,
  });
}

function deriveSourceBasis(db, context) {
  const { authorization, candidate, run, sourceAuthority } = context;
  const pr6LineageRows = reconstructPr6LineageRows(db, candidate);
  const economicLineageCandidateFingerprint = computeEconomicLineageCandidateFingerprint({
    branchId: candidate.branchId,
    companyId: candidate.companyId,
    contractId: candidate.contractId ?? null,
    coverageEndExclusive: candidate.sliceEndDateExclusive,
    coverageStart: candidate.sliceStartDate,
    currency: candidate.currency,
    rentalId: candidate.rentalId,
    rentalLineId: candidate.rentalLineId,
  });
  const sourceLineageHash = computeSourceLineageHash({
    acceptedDryRunsHash: authorization.acceptedDryRunsHash,
    activationBoundaryId: candidate.activationBoundaryId,
    branchId: candidate.branchId,
    candidateId: candidate.id,
    candidateResultHash: candidate.resultHash,
    closedPeriodVersionId: candidate.closedPeriodVersionId,
    companyId: candidate.companyId,
    completeInputSetHash: run.sourceInputManifestHash,
    conductedUpdVersionId: candidate.currentConductedUpdVersionId,
    coverageSetId: candidate.coverageSetId,
    coverageSliceId: candidate.coverageSliceId,
    dryRunId: run.id,
    formedUpdVersionId: candidate.formedUpdVersionId,
    periodId: candidate.periodId,
    pr6LineageRows,
    snapshotId: candidate.snapshotId,
    sourceAdapterAuthority: {
      authorityVersion: sourceAuthority.authorityVersion,
      recordHash: sourceAuthority.recordHash,
      recordId: sourceAuthority.recordId,
    },
    sourceOwnershipManifestHash: authorization.sourceOwnershipManifestHash,
    sourceSystem: 'rentcore.billing_source_authority.v1',
    updId: candidate.updId,
    updLineId: candidate.updLineId,
    updLineVersionId: candidate.updLineVersionId,
  });
  return Object.freeze({
    economicLineageCandidateFingerprint,
    pr6LineageRows,
    sourceLineageHash,
  });
}

function deriveAuthorityDenialBasis(db, context) {
  const basis = deriveSourceBasis(db, context);
  return Object.freeze({
    economicLineageCandidateFingerprint: basis.economicLineageCandidateFingerprint,
    event: Object.freeze({
      branchId: context.candidate.branchId,
      companyId: context.candidate.companyId,
      economicLineageKey: null,
      economicSourceRevisionKey: null,
      sourceLineageHash: basis.sourceLineageHash,
    }),
  });
}

function deriveEventCore(db, context, { correlationId, occurredAt }) {
  const { authorization, activation, candidate, run, selectedDueDate, sourceAuthority, producerAuthority } = context;
  const basis = deriveSourceBasis(db, context);
  const scopedCandidate = { ...candidate, companyId: candidate.companyId, branchId: candidate.branchId };
  const root = resolveCoverageRoot(db, scopedCandidate);
  const rootSourceDocumentLineageId = candidate.updId;
  const rootCoverageLineageId = computeCoverageLineageRootId({
    branchId: candidate.branchId,
    companyId: candidate.companyId,
    rootCoverageSetId: root.rootCoverageSetId,
    rootCoverageSliceId: root.rootCoverageSliceId,
    rootSourceDocumentLineageId,
  });
  const economicDimensions = {
    branchId: candidate.branchId,
    companyId: candidate.companyId,
    contractId: candidate.contractId ?? null,
    coverageEndExclusive: candidate.sliceEndDateExclusive,
    coverageStart: candidate.sliceStartDate,
    currency: candidate.currency,
    rentalId: candidate.rentalId,
    rentalLineId: candidate.rentalLineId,
    rootCoverageLineageId,
    rootSourceDocumentLineageId,
  };
  const economicLineageKey = computeEconomicLineageKey(economicDimensions);
  const revisionHash = currentPr6RevisionHash(db, candidate, basis.pr6LineageRows);
  const economicSourceRevisionKey = computeEconomicSourceRevisionKey({
    branchId: candidate.branchId,
    companyId: candidate.companyId,
    conductedUpdVersionId: candidate.currentConductedUpdVersionId,
    coverageSetId: candidate.coverageSetId,
    coverageSliceId: candidate.coverageSliceId,
    currentPr6RevisionHash: revisionHash,
    economicLineageKey,
    formedUpdVersionId: candidate.formedUpdVersionId,
    updLineVersionId: candidate.updLineVersionId,
  });
  const unknown = candidate.dueDateProvenance === 'unknown';
  const event = {
    companyId: candidate.companyId,
    branchId: candidate.branchId,
    economicLineageKey,
    economicSourceRevisionKey,
    rootSourceDocumentLineageId,
    rootCoverageLineageId,
    currentPr6RevisionHash: revisionHash,
    eventSchemaVersion: 'ActualReceivableEligibleV1',
    eventVersion: 1,
    dryRunId: run.id,
    candidateId: candidate.id,
    candidateResultHash: candidate.resultHash,
    completeInputSetHash: run.sourceInputManifestHash,
    policyManifestHash: run.policyManifestHash,
    sourceOwnershipManifestHash: authorization.sourceOwnershipManifestHash,
    acceptedDryRunsHash: authorization.acceptedDryRunsHash,
    acceptedPr8EvidenceHash: authorization.acceptedPr8EvidenceHash,
    activationBoundaryId: candidate.activationBoundaryId,
    activationRecordId: activation.recordId,
    activationCohortRef: authorization.activationCohortRef,
    cohortHash: activation.cohortHash,
    periodId: candidate.periodId,
    closedPeriodVersionId: candidate.closedPeriodVersionId,
    snapshotId: candidate.snapshotId,
    updId: candidate.updId,
    formedUpdVersionId: candidate.formedUpdVersionId,
    conductedUpdVersionId: candidate.currentConductedUpdVersionId,
    updLineId: candidate.updLineId,
    updLineVersionId: candidate.updLineVersionId,
    coverageSetId: candidate.coverageSetId,
    coverageSliceId: candidate.coverageSliceId,
    clientId: candidate.clientId,
    contractId: candidate.contractId ?? null,
    rentalId: candidate.rentalId,
    rentalLineId: candidate.rentalLineId,
    sliceStartDate: candidate.sliceStartDate,
    sliceEndDateExclusive: candidate.sliceEndDateExclusive,
    currency: candidate.currency,
    companyTimezoneSnapshot: run.companyTimezone,
    netAmountMinor: Number(candidate.sourceNetMinor),
    vatAmountMinor: Number(candidate.sourceVatMinor),
    grossAmountMinor: Number(candidate.sourceGrossMinor),
    originalAmountMinor: Number(candidate.proposedOriginalAmountMinor),
    amountBasis: 'gross',
    amountBasisPolicyRef: authorization.amountBasisPolicyRef,
    amountBasisPolicyHash: authorization.amountBasisPolicyHash,
    contractualDueDate: candidate.contractualDueDate ?? null,
    dueDateProvenance: candidate.dueDateProvenance,
    dueDateEvidenceRef: candidate.dueDateEvidenceRef ?? null,
    dueDatePolicySetHash: authorization.dueDatePolicySetHash,
    selectedDueDateGateKind: selectedDueDate.gateKind,
    selectedDueDatePolicyId: selectedDueDate.policyId,
    selectedDueDatePolicyVersion: selectedDueDate.policyVersion,
    selectedDueDatePolicyHash: selectedDueDate.policyHash,
    dueDateTreatment: unknown ? 'post_without_aging_v1' : 'proven_contractual_date_v1',
    unknownDueDateTreatmentMappingId: unknown ? selectedDueDate.mappingId : null,
    unknownDueDateTreatmentMappingVersion: unknown ? selectedDueDate.mappingVersion : null,
    unknownDueDateTreatmentMappingHash: unknown ? selectedDueDate.mappingHash : null,
    sourceAdapterAuthorityRecordId: sourceAuthority.recordId,
    sourceAdapterAuthorityVersion: sourceAuthority.authorityVersion,
    sourceAdapterAuthorityRecordHash: sourceAuthority.recordHash,
    producerAuthorityRecordId: producerAuthority.recordId,
    producerAuthorityVersion: producerAuthority.authorityVersion,
    producerAuthorityRecordHash: producerAuthority.recordHash,
    producerAuthorityCompanyId: producerAuthority.companyId,
    producerAuthorityBranchId: producerAuthority.branchId,
    producerAuthorityKind: producerAuthority.authorityKind,
    writeAuthorizationRecordId: authorization.recordId,
    sourceLineageHash: basis.sourceLineageHash,
    correlationId,
    schemaVersion: 1,
    occurredAt,
    createdAt: occurredAt,
  };
  event.eventHash = computeEligibleEventHash(event);
  return Object.freeze({
    event: materializeInert(event),
    economicLineageCandidateFingerprint: basis.economicLineageCandidateFingerprint,
  });
}

function monotonicFloor(db, companyId, branchId) {
  const row = db.prepare(`
    SELECT MAX(operationalTimestamp) AS monotonicFloor
    FROM (
      SELECT createdAt AS operationalTimestamp
      FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
      WHERE companyId = ? AND branchId = ?
      UNION ALL
      SELECT createdAt
      FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}
      WHERE companyId = ? AND branchId = ?
      UNION ALL
      SELECT postedAt
      FROM ${CANONICAL_RECEIVABLES_TABLE}
      WHERE companyId = ? AND branchId = ?
        AND sourceSystem = 'rentcore.billing_source_authority.v1'
      UNION ALL
      SELECT createdAt
      FROM ${CANONICAL_RECEIVABLES_TABLE}
      WHERE companyId = ? AND branchId = ?
        AND sourceSystem = 'rentcore.billing_source_authority.v1'
      UNION ALL
      SELECT createdAt
      FROM ${FINANCIAL_AUDIT_EVENTS_TABLE}
      WHERE companyId = ? AND branchId = ?
        AND eventType = 'canonical_receivable.initial_posted.v1'
      UNION ALL
      SELECT createdAt
      FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE}
      WHERE companyId = ? AND branchId = ?
    )
  `).get(
    companyId, branchId,
    companyId, branchId,
    companyId, branchId,
    companyId, branchId,
    companyId, branchId,
    companyId, branchId,
  );
  if (row.monotonicFloor === null) return null;
  return parseUtcMilliseconds(row.monotonicFloor, 'monotonicFloor');
}

function incompleteTransitions(db, companyId, branchId) {
  return db.prepare(`
    SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
    WHERE companyId = ? AND branchId = ? AND operationDomain = ? AND state != 'COMPLETE'
    ORDER BY scopeSequence ASC
  `).all(companyId, branchId, OPERATION_DOMAIN).map(normalizeTransitionRow);
}

function conflictProjectionFromPersisted(db, conflict) {
  const authorization = db.prepare(`
    SELECT recordHash FROM ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE} WHERE recordId = ?
  `).get(conflict.writeAuthorizationRecordId);
  const activation = db.prepare(`
    SELECT recordHash FROM ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE} WHERE recordId = ?
  `).get(conflict.activationRecordId);
  if (!authorization || !activation) throw repositoryError(ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED);
  return {
    ...conflict,
    activationRecordHash: activation.recordHash,
    writeAuthorizationRecordHash: authorization.recordHash,
  };
}

function verifyPersistedConflictPair(db, authorityRepository, conflictInput) {
  const conflict = normalizeConflictRow(conflictInput);
  const transitionRaw = db.prepare(`
    SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
    WHERE transitionId = ?
  `).get(conflict.transitionId);
  if (!transitionRaw) throw repositoryError(ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED);
  const transition = normalizeTransitionRow(transitionRaw);
  if (
    transition.conflictId !== conflict.id
    || transition.companyId !== conflict.companyId
    || transition.branchId !== conflict.branchId
    || transition.denialAttemptId !== conflict.denialAttemptId
    || transition.conflictHash !== conflict.conflictHash
  ) throw repositoryError(ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED);
  assertUuidV4(conflict.denialAttemptId, 'denialAttemptId');
  assertRfc3339Milliseconds(conflict.deniedAttemptedAt, 'deniedAttemptedAt');
  assertRfc3339Milliseconds(conflict.evidenceAttemptedAt, 'evidenceAttemptedAt');
  if (conflict.detectedAt !== conflict.deniedAttemptedAt || conflict.createdAt !== conflict.evidenceAttemptedAt) {
    throw repositoryError(ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED);
  }
  const observation = parseCanonicalJson(conflict.conflictObservationJson, 'conflictObservationJson');
  const contracts = buildConflictContracts({
    conflictType: observation.conflictType,
    denialAttemptId: observation.denialAttemptId,
    deniedAttemptedAt: observation.deniedAttemptedAt,
    expectedProjection: observation.expectedProjection,
    observedProjection: observation.observedProjection,
  });
  if (
    contracts.conflictObservationHash !== conflict.conflictObservationHash
    || contracts.expectedFingerprint !== conflict.expectedFingerprint
    || contracts.observedFingerprint !== conflict.observedFingerprint
    || observation.conflictType !== conflict.conflictType
  ) throw repositoryError(ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED);
  for (const [jsonField, hashField, kind] of [
    ['sourceAuthorityChainSnapshotJson', 'sourceAuthorityChainSnapshotHash', 'source_adapter'],
    ['producerAuthorityChainSnapshotJson', 'producerAuthorityChainSnapshotHash', 'eligibility_producer'],
    ['postingAuthorityChainSnapshotJson', 'postingAuthorityChainSnapshotHash', 'canonical_posting_adapter'],
  ]) {
    authorityRepository.verifyFrozenAuthorityState({
      snapshot: conflict[jsonField],
      snapshotHash: conflict[hashField],
      expectedAuthorityKind: kind,
    });
  }
  const projection = conflictProjectionFromPersisted(db, conflict);
  if (computeConflictHash(projection) !== conflict.conflictHash) {
    throw repositoryError(ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED);
  }
  try {
    verifyConflictTransition({ transition, conflict, committedRows: operationalRows(db) });
  } catch {
    throw repositoryError(ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED);
  }
  return Object.freeze({ conflict, transition, projection });
}

function classifyConflictReplay(db, authorityRepository, packageValue) {
  const located = [];
  const byAttempt = db.prepare(`
    SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE} WHERE denialAttemptId = ?
  `).get(packageValue.denialAttemptId);
  const byHash = db.prepare(`
    SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE}
    WHERE companyId = ? AND conflictHash = ?
  `).get(
    packageValue.conflictCandidateProjection.companyId,
    packageValue.conflictHashCandidate,
  );
  for (const row of [byAttempt, byHash]) {
    if (row && !located.some(existing => existing.id === row.id)) located.push(row);
  }
  const verified = [];
  for (const row of located) {
    try {
      verified.push(verifyPersistedConflictPair(db, authorityRepository, row));
    } catch {
      throw repositoryError(ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED);
    }
  }
  if (verified.length > 1) throw repositoryError(ERROR_CODES.DENIAL_ATTEMPT_ID_COLLISION);
  if (verified.length === 0) return Object.freeze({ mode: 'NEW_EVIDENCE_INSERT' });
  const existing = verified[0];
  if (
    existing.conflict.denialAttemptId !== packageValue.denialAttemptId
    || existing.conflict.conflictHash !== packageValue.conflictHashCandidate
    || canonicalJson(existing.projection) !== canonicalJson({
      ...existing.projection,
      ...packageValue.conflictCandidateProjection,
    })
    || existing.conflict.sourceAuthorityChainSnapshotJson !== canonicalJson(packageValue.sourceAuthorityChainSnapshot)
    || existing.conflict.producerAuthorityChainSnapshotJson !== canonicalJson(packageValue.producerAuthorityChainSnapshot)
    || existing.conflict.postingAuthorityChainSnapshotJson !== canonicalJson(packageValue.postingAuthorityChainSnapshot)
  ) throw repositoryError(ERROR_CODES.DENIAL_ATTEMPT_ID_COLLISION);
  return Object.freeze({ mode: 'EXACT_REPLAY', ...existing });
}

function createCanonicalActualEligibilityEventRepository(
  db,
  runtimeContract = DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
) {
  assertCanonicalActualPostingStructure(db);
  assertCanonicalActualPostingRuntimeContract(runtimeContract);
  const authorityRepository = createCanonicalActualPostingAuthorityRepository(db);

  function readEventById(id) {
    assertIdentifier(id, 'eventId');
    const row = db.prepare(`SELECT * FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE} WHERE id = ?`).get(id);
    return row ? validateEligibleEventRecord(normalizeEventRow(row)) : null;
  }

  function readConflictPair(transitionId) {
    assertHash(transitionId, 'transitionId');
    const conflict = db.prepare(`
      SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE} WHERE transitionId = ?
    `).get(transitionId);
    if (!conflict) return null;
    return verifyPersistedConflictPair(db, authorityRepository, conflict);
  }

  function assertRecoveryPermission(conflict) {
    const authorization = authorityRepository.readWriteAuthorizationRecord(conflict.writeAuthorizationRecordId);
    if (
      !authorization
      || authorization.companyId !== conflict.companyId
      || authorization.branchId !== conflict.branchId
      || authorization.denialEvidenceTable !== CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE
      || authorization.denialEvidencePermission !== 'canonical_receivable_posting_conflicts.append_after_denial.v1'
      || authorization.denialTransitionTable !== CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE
      || authorization.denialTransitionPermission !== 'canonical_receivable_posting_conflict_transitions.create_and_advance.v1'
    ) throw repositoryError(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
  }

  function reconcileTransition(transitionId) {
    while (true) {
      beginImmediate(db);
      try {
        const rawConflict = db.prepare(`
          SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE} WHERE transitionId = ?
        `).get(transitionId);
        if (!rawConflict) throw repositoryError(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
        let pair;
        try {
          pair = verifyPersistedConflictPair(db, authorityRepository, rawConflict);
        } catch {
          throw repositoryError(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
        }
        assertRecoveryPermission(pair.conflict);
        const { conflict } = pair;
        const transition = pair.transition;
        if (transition.state === 'COMPLETE') {
          db.exec('COMMIT');
          return pair;
        }
        if (transition.attemptApplied === 0) {
          const result = attemptAccountingResult(transition);
          const json = canonicalJson(result);
          const hash = sha256Canonical(result);
          db.prepare(`
            UPDATE ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
            SET attemptApplied = 1, attemptResultJson = ?, attemptResultHash = ?
            WHERE transitionId = ?
          `).run(json, hash, transitionId);
        } else if (transition.rateApplied === 0) {
          const result = rateAccountingResult({
            transition,
            conflict,
            committedRows: operationalRows(db),
          });
          const json = canonicalJson(result);
          const hash = sha256Canonical(result);
          db.prepare(`
            UPDATE ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
            SET state = 'ACCOUNTED', rateApplied = 1, rateResultJson = ?, rateResultHash = ?
            WHERE transitionId = ?
          `).run(json, hash, transitionId);
        } else if (transition.circuitApplied === 0) {
          const result = circuitTransitionResult({
            transition,
            conflict,
            committedRows: operationalRows(db),
          });
          const json = canonicalJson(result);
          const hash = sha256Canonical(result);
          db.prepare(`
            UPDATE ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
            SET state = 'CIRCUIT_APPLIED', circuitApplied = 1,
                circuitResultJson = ?, circuitResultHash = ?
            WHERE transitionId = ?
          `).run(json, hash, transitionId);
        } else if (transition.state === 'CIRCUIT_APPLIED') {
          db.prepare(`
            UPDATE ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
            SET state = 'COMPLETE' WHERE transitionId = ?
          `).run(transitionId);
        } else {
          throw repositoryError(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
        }
        const reread = db.prepare(`
          SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE} WHERE transitionId = ?
        `).get(transitionId);
        try {
          verifyPersistedConflictPair(db, authorityRepository, reread);
        } catch {
          throw repositoryError(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
        }
        db.exec('COMMIT');
      } catch (error) {
        rollbackQuietly(db);
        mapAndThrow(error);
      }
    }
  }

  function reconcileScope(scope) {
    const inert = materializeInert(scope, 'scope');
    assertExactObjectKeys(inert, ['branchId', 'companyId'], 'scope');
    assertIdentifier(inert.companyId, 'companyId');
    assertIdentifier(inert.branchId, 'branchId');
    while (true) {
      const incomplete = incompleteTransitions(db, inert.companyId, inert.branchId);
      if (incomplete.length === 0) return true;
      for (const transition of incomplete) reconcileTransition(transition.transitionId);
    }
  }

  function authorityRowsFromFrozenSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.members) || snapshot.members.length === 0) {
      throw repositoryError(ERROR_CODES.AUTHORITY_FROZEN_DENIAL_INTEGRITY_FAILED);
    }
    return snapshot.members.map(member => {
      const row = authorityRepository.readAuthorityRecord(member.authorityRecordId);
      if (
        !row
        || row.recordHash !== member.authorityRecordHash
        || row.authorityVersion !== member.authorityVersion
        || row.authorityId !== snapshot.boundary.authorityId
        || row.authorityKind !== snapshot.boundary.authorityKind
        || row.companyId !== snapshot.boundary.companyId
        || row.branchId !== snapshot.boundary.branchId
      ) throw repositoryError(ERROR_CODES.AUTHORITY_FROZEN_DENIAL_INTEGRITY_FAILED);
      return row;
    });
  }

  function reconstructNonAuthorityDenial(packageValue) {
    const mode = NON_AUTHORITY_RECONSTRUCTION_REGISTRY[packageValue.conflictType];
    if (!mode) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    if (mode === 'posting_graph') {
      throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    }
    const selectors = frozenDenialSelectors.get(packageValue);
    if (!selectors) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    const candidate = packageValue.conflictCandidateProjection;
    const command = {
      activationRecordId: selectors.activationRecordId,
      branchId: candidate.branchId,
      candidateId: selectors.candidateId,
      companyId: candidate.companyId,
      dryRunId: selectors.dryRunId,
      writeAuthorizationRecordId: selectors.writeAuthorizationRecordId,
    };
    const deniedAt = parseUtcMilliseconds(packageValue.deniedAttemptedAt);
    const historicalAuthorityChains = new Map([
      ['source_adapter', authorityRowsFromFrozenSnapshot(packageValue.sourceAuthorityChainSnapshot)],
      ['eligibility_producer', authorityRowsFromFrozenSnapshot(packageValue.producerAuthorityChainSnapshot)],
      ['canonical_posting_adapter', authorityRowsFromFrozenSnapshot(packageValue.postingAuthorityChainSnapshot)],
    ]);
    const context = loadAcceptedContext(
      db,
      authorityRepository,
      command,
      deniedAt,
      runtimeContract,
      { historicalAuthorityChains },
    );
    if (context.authorityDenial) {
      throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    }
    const basis = deriveAuthorityDenialBasis(db, context);
    const correlationId = deriveRepositoryId(
      'rentcore.canonical_actual_posting.eligibility_correlation_identity',
      {
        branchId: command.branchId,
        companyId: command.companyId,
        denialAttemptId: packageValue.denialAttemptId,
        economicLineageCandidateFingerprint: basis.economicLineageCandidateFingerprint,
      },
    );
    const derived = mode === 'source_lineage'
      ? basis
      : deriveEventCore(db, context, {
        correlationId,
        occurredAt: packageValue.deniedAttemptedAt,
      });
    let rebuilt;
    if (mode === 'accepted_context' || mode === 'source_lineage') {
      if (!context.nonAuthorityDenial || context.nonAuthorityDenial.conflictType !== packageValue.conflictType) {
        throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
      }
      rebuilt = buildNonAuthorityConflictPackage({
        conflictType: context.nonAuthorityDenial.conflictType,
        context,
        denialAttemptId: packageValue.denialAttemptId,
        deniedAttemptedAt: packageValue.deniedAttemptedAt,
        derived,
        expectedSpecific: context.nonAuthorityDenial.expectedSpecific,
        observedSpecific: context.nonAuthorityDenial.observedSpecific,
      });
    } else {
      const existingEvent = candidate.eventId == null ? null : db.prepare(`
        SELECT * FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE} WHERE id = ?
      `).get(candidate.eventId);
      if (!existingEvent) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
      rebuilt = buildEventConflictPackage({
        attemptedEvent: derived.event,
        existingEvent: validateEligibleEventRecord(normalizeEventRow(existingEvent)),
        economicLineageCandidateFingerprint: derived.economicLineageCandidateFingerprint,
        context,
        denialAttemptId: packageValue.denialAttemptId,
        deniedAttemptedAt: packageValue.deniedAttemptedAt,
      });
      if (rebuilt.conflictType !== packageValue.conflictType) {
        throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
      }
    }
    if (
      canonicalJson(rebuilt.packageValue) !== canonicalJson(packageValue)
      || rebuilt.packageValue.conflictHashCandidate !== packageValue.conflictHashCandidate
    ) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    return rebuilt.packageValue;
  }

  function verifyFrozenPackageAgainstSnapshots(packageValue) {
    const snapshotsByKind = new Map([
      ['source_adapter', {
        hash: packageValue.sourceAuthorityChainSnapshotHash,
        snapshot: packageValue.sourceAuthorityChainSnapshot,
      }],
      ['eligibility_producer', {
        hash: packageValue.producerAuthorityChainSnapshotHash,
        snapshot: packageValue.producerAuthorityChainSnapshot,
      }],
      ['canonical_posting_adapter', {
        hash: packageValue.postingAuthorityChainSnapshotHash,
        snapshot: packageValue.postingAuthorityChainSnapshot,
      }],
    ]);
    for (const [kind, entry] of snapshotsByKind) {
      authorityRepository.verifyFrozenAuthorityState({
        snapshot: entry.snapshot,
        snapshotHash: entry.hash,
        expectedAuthorityKind: kind,
      });
    }

    const candidate = packageValue.conflictCandidateProjection;
    const authorityMatch = /^(SOURCE_ADAPTER|ELIGIBILITY_PRODUCER|CANONICAL_POSTING_ADAPTER)_(.+)$/.exec(
      packageValue.conflictType,
    );
    if (authorityMatch) {
      const kindByPrefix = {
        SOURCE_ADAPTER: 'source_adapter',
        ELIGIBILITY_PRODUCER: 'eligibility_producer',
        CANONICAL_POSTING_ADAPTER: 'canonical_posting_adapter',
      };
      const selectedKind = kindByPrefix[authorityMatch[1]];
      const boundIds = {
        source_adapter: candidate.sourceAdapterAuthorityRecordId,
        eligibility_producer: candidate.producerAuthorityRecordId,
        canonical_posting_adapter: candidate.postingAdapterAuthorityRecordId,
      };
      const reconstructedCandidateSets = [];
      for (const [authorityKind, entry] of snapshotsByKind) {
        const boundRecord = authorityRepository.readAuthorityRecord(boundIds[authorityKind]);
        if (!boundRecord) {
          throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
        }
        const candidates = authorityRepository.buildAuthorityCandidates({
          attemptedAt: packageValue.deniedAttemptedAt,
          binding: {
            ...runtimeContract.authorities[authorityKind],
            branchId: candidate.branchId,
            companyId: candidate.companyId,
            recordHash: boundRecord.recordHash,
            recordId: boundRecord.recordId,
            sourceOwnershipManifestHash: candidate.sourceOwnershipManifestHash,
          },
          chain: authorityRowsFromFrozenSnapshot(entry.snapshot),
        });
        if (canonicalJson(candidates) !== canonicalJson(entry.snapshot.candidates)) {
          throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
        }
        reconstructedCandidateSets.push({ authorityKind, candidates });
      }
      const selected = selectGlobalAuthorityDenial(reconstructedCandidateSets);
      if (
        !selected
        || selected.authorityKind !== selectedKind
        || selected.candidate.stateCode !== authorityMatch[2]
      ) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);

      for (const [authorityKind, entry] of snapshotsByKind) {
        const hasCandidates = entry.snapshot.candidates.length > 0;
        const expectedState = authorityKind === selectedKind
          ? 'selected'
          : hasCandidates ? 'suppressed_by_higher_kind' : 'unaffected_active_latest';
        if (entry.snapshot.precedenceState !== expectedState) {
          throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
        }
      }

      const boundRecord = authorityRepository.readAuthorityRecord(boundIds[selectedKind]);
      const observedRecord = authorityRepository.readAuthorityRecord(selected.candidate.authorityRecordId);
      const selectedSnapshot = snapshotsByKind.get(selectedKind).snapshot;
      if (!boundRecord || !observedRecord) {
        throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
      }
      const common = {
        denialAttemptId: packageValue.denialAttemptId,
        deniedAttemptedAt: packageValue.deniedAttemptedAt,
        postingAuthorityChainSnapshotHash: packageValue.postingAuthorityChainSnapshotHash,
        producerAuthorityChainSnapshotHash: packageValue.producerAuthorityChainSnapshotHash,
        sourceAuthorityChainSnapshotHash: packageValue.sourceAuthorityChainSnapshotHash,
      };
      const expectedProjection = authorityDenialSide({
        common,
        record: boundRecord,
        latestRecordHash: boundRecord.recordHash,
        stateCode: selected.candidate.stateCode,
        expected: true,
        ownershipManifestHash: candidate.sourceOwnershipManifestHash,
        runtimeIdentity: runtimeContract.authorities[selectedKind],
      });
      const observedProjection = authorityDenialSide({
        common,
        record: observedRecord,
        latestRecordHash: selectedSnapshot.members[selectedSnapshot.members.length - 1].authorityRecordHash,
        stateCode: selected.candidate.stateCode,
        expected: false,
        ownershipManifestHash: observedRecord.sourceOwnershipManifestHash,
      });
      if (
        canonicalJson(expectedProjection) !== canonicalJson(packageValue.expectedProjection)
        || canonicalJson(observedProjection) !== canonicalJson(packageValue.observedProjection)
        || candidate.deniedAuthorityKind !== selectedKind
        || candidate.deniedAuthorityRecordId !== observedRecord.recordId
        || candidate.deniedAuthorityVersion !== observedRecord.authorityVersion
        || candidate.deniedAuthorityRecordHash !== observedRecord.recordHash
      ) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    } else {
      for (const entry of snapshotsByKind.values()) {
        if (
          entry.snapshot.precedenceState !== 'unaffected_active_latest'
          || entry.snapshot.candidates.length !== 0
        ) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
      }
      const common = {
        denialAttemptId: packageValue.denialAttemptId,
        deniedAttemptedAt: packageValue.deniedAttemptedAt,
        postingAdapterAuthorityBranchId: candidate.postingAdapterAuthorityBranchId,
        postingAdapterAuthorityCompanyId: candidate.postingAdapterAuthorityCompanyId,
        postingAdapterAuthorityKind: candidate.postingAdapterAuthorityKind,
        postingAdapterAuthorityRecordHash: candidate.postingAdapterAuthorityRecordHash,
        postingAdapterAuthorityRecordId: candidate.postingAdapterAuthorityRecordId,
        postingAdapterAuthorityVersion: candidate.postingAdapterAuthorityVersion,
        postingAuthorityChainSnapshotHash: packageValue.postingAuthorityChainSnapshotHash,
        producerAuthorityBranchId: candidate.producerAuthorityBranchId,
        producerAuthorityCompanyId: candidate.producerAuthorityCompanyId,
        producerAuthorityKind: candidate.producerAuthorityKind,
        producerAuthorityRecordHash: candidate.producerAuthorityRecordHash,
        producerAuthorityRecordId: candidate.producerAuthorityRecordId,
        producerAuthorityVersion: candidate.producerAuthorityVersion,
        producerAuthorityChainSnapshotHash: packageValue.producerAuthorityChainSnapshotHash,
        sourceAuthorityChainSnapshotHash: packageValue.sourceAuthorityChainSnapshotHash,
      };
      for (const projection of [packageValue.expectedProjection, packageValue.observedProjection]) {
        for (const [key, value] of Object.entries(common)) {
          if (projection[key] !== value) {
            throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
          }
        }
      }
      if (
        candidate.deniedAuthorityKind !== null
        || candidate.deniedAuthorityRecordId !== null
        || candidate.deniedAuthorityVersion !== null
        || candidate.deniedAuthorityRecordHash !== null
      ) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
      reconstructNonAuthorityDenial(packageValue);
    }

    if (computeConflictHash(candidate) !== packageValue.conflictHashCandidate) {
      throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    }
  }

  function persistDenialEvidence(packageInput) {
    let packageValue;
    let blockedScope = null;
    beginImmediate(db);
    try {
      packageValue = assertFrozenDenialPackage(packageInput);
      const classification = classifyConflictReplay(db, authorityRepository, packageValue);
      verifyFrozenPackageAgainstSnapshots(packageValue);
      if (classification.mode === 'EXACT_REPLAY') {
        db.exec('COMMIT');
        return Object.freeze({ conflict: classification.conflict, replayed: true });
      }
      const candidateScope = packageValue.conflictCandidateProjection;
      const incomplete = incompleteTransitions(db, candidateScope.companyId, candidateScope.branchId);
      if (incomplete.length > 0) {
        blockedScope = { companyId: candidateScope.companyId, branchId: candidateScope.branchId };
        rollbackQuietly(db);
      } else {
        const clock = readRepositoryClock();
        const floor = monotonicFloor(db, candidateScope.companyId, candidateScope.branchId);
        if (floor !== null && clock.milliseconds < floor) {
          throw repositoryError(ERROR_CODES.CONFLICT_EVIDENCE_PERSISTENCE_FAILED);
        }
        const authorization = authorityRepository.readWriteAuthorizationRecord(
          candidateScope.writeAuthorizationRecordId,
        );
        if (!authorization) throw repositoryError(ERROR_CODES.CONFLICT_EVIDENCE_PERSISTENCE_FAILED);
        assertActiveWindow(authorization, clock.milliseconds, ERROR_CODES.CONFLICT_EVIDENCE_PERSISTENCE_FAILED);
        if (
          authorization.denialEvidencePermission !== 'canonical_receivable_posting_conflicts.append_after_denial.v1'
          || authorization.denialTransitionPermission !== 'canonical_receivable_posting_conflict_transitions.create_and_advance.v1'
        ) throw repositoryError(ERROR_CODES.CONFLICT_EVIDENCE_PERSISTENCE_FAILED);
        const maximum = db.prepare(`
          SELECT MAX(scopeSequence) AS maximum
          FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE}
          WHERE companyId = ? AND branchId = ? AND operationDomain = ?
        `).get(candidateScope.companyId, candidateScope.branchId, OPERATION_DOMAIN).maximum;
        const scopeSequence = maximum === null ? 1 : Number(maximum) + 1;
        assertSafeInteger(scopeSequence, 'scopeSequence', { minimum: 1 });
        const rate = selectRateQualifyingAttempts(operationalRows(db), {
          companyId: candidateScope.companyId,
          branchId: candidateScope.branchId,
          operationDomain: OPERATION_DOMAIN,
          evidenceAttemptedAt: clock.timestamp,
          scopeSequence,
        });
        if (rate.rows.length >= 30) throw repositoryError(ERROR_CODES.CONFLICT_EVIDENCE_PERSISTENCE_FAILED);

        const identityInput = {
          branchId: candidateScope.branchId,
          companyId: candidateScope.companyId,
          conflictHash: packageValue.conflictHashCandidate,
          denialAttemptId: packageValue.denialAttemptId,
        };
        const conflictId = deriveRepositoryId(
          'rentcore.canonical_actual_posting.conflict_row_identity',
          identityInput,
        );
        const correlationId = deriveRepositoryId(
          'rentcore.canonical_actual_posting.conflict_correlation_identity',
          identityInput,
        );
        if (db.prepare(`SELECT 1 FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE} WHERE id = ?`).get(conflictId)) {
          throw repositoryError('CANONICAL_REPOSITORY_ID_COLLISION');
        }
        const circuitRule = ['AUTHORIZATION_DRIFT', 'ACTIVATION_DRIFT'].includes(packageValue.conflictType)
          ? 'fifth_in_five'
          : 'immediate';
        const pending = createPendingConflictTransition({
          branchId: candidateScope.branchId,
          circuitRule,
          companyId: candidateScope.companyId,
          conflictHash: packageValue.conflictHashCandidate,
          conflictId,
          conflictType: packageValue.conflictType,
          createdAt: clock.timestamp,
          denialAttemptId: packageValue.denialAttemptId,
          scopeSequence,
        });
        const observation = buildConflictContracts({
          conflictType: packageValue.conflictType,
          denialAttemptId: packageValue.denialAttemptId,
          deniedAttemptedAt: packageValue.deniedAttemptedAt,
          expectedProjection: packageValue.expectedProjection,
          observedProjection: packageValue.observedProjection,
        });
        const conflict = {};
        for (const column of REQUIRED_COLUMNS[CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE]) {
          if (Object.prototype.hasOwnProperty.call(candidateScope, column)) conflict[column] = candidateScope[column];
        }
        Object.assign(conflict, {
          id: conflictId,
          severity: 'p0',
          conflictObservationJson: observation.conflictObservationJson,
          conflictObservationHash: observation.conflictObservationHash,
          expectedFingerprint: observation.expectedFingerprint,
          observedFingerprint: observation.observedFingerprint,
          denialAttemptId: packageValue.denialAttemptId,
          deniedAttemptedAt: packageValue.deniedAttemptedAt,
          evidenceAttemptedAt: clock.timestamp,
          sourceAuthorityChainSnapshotJson: canonicalJson(packageValue.sourceAuthorityChainSnapshot),
          sourceAuthorityChainSnapshotHash: packageValue.sourceAuthorityChainSnapshotHash,
          producerAuthorityChainSnapshotJson: canonicalJson(packageValue.producerAuthorityChainSnapshot),
          producerAuthorityChainSnapshotHash: packageValue.producerAuthorityChainSnapshotHash,
          postingAuthorityChainSnapshotJson: canonicalJson(packageValue.postingAuthorityChainSnapshot),
          postingAuthorityChainSnapshotHash: packageValue.postingAuthorityChainSnapshotHash,
          correlationId,
          detectorVersion: 'canonical-posting-conflict-detector-v1',
          conflictHash: packageValue.conflictHashCandidate,
          transitionId: pending.transitionId,
          schemaVersion: 1,
          detectedAt: packageValue.deniedAttemptedAt,
          createdAt: clock.timestamp,
        });
        for (const column of REQUIRED_COLUMNS[CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE]) {
          if (!Object.prototype.hasOwnProperty.call(conflict, column)) {
            throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
          }
        }
        insertExact(
          db,
          CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
          conflict,
          REQUIRED_COLUMNS[CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE],
        );
        insertExact(
          db,
          CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE,
          pending,
          REQUIRED_COLUMNS[CANONICAL_RECEIVABLE_POSTING_CONFLICT_TRANSITIONS_TABLE],
        );
        verifyPersistedConflictPair(db, authorityRepository, conflict);
        db.exec('COMMIT');
        let finalPair;
        try {
          finalPair = reconcileTransition(pending.transitionId);
        } catch (error) {
          if (error.code === ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED) throw error;
          if (error.code === ERROR_CODES.POSTING_CONCURRENT_CONFLICT) throw error;
          throw repositoryError(ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED);
        }
        if (finalPair.transition.state !== 'COMPLETE') {
          throw repositoryError(ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED);
        }
        return Object.freeze({ conflict: finalPair.conflict, replayed: false });
      }
    } catch (error) {
      rollbackQuietly(db);
      mapAndThrow(error);
    }
    if (blockedScope) {
      try {
        reconcileScope(blockedScope);
      } catch {
        // The blocked invocation's result remains recovery-required by contract.
      }
      throw repositoryError(ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED);
    }
    throw repositoryError(ERROR_CODES.CONFLICT_EVIDENCE_PERSISTENCE_FAILED);
  }

  function authorityTemporalState(record, deniedAttemptedAt) {
    const attempted = parseUtcMilliseconds(deniedAttemptedAt);
    if (attempted < parseUtcMilliseconds(record.effectiveFrom)) return 'not_yet_effective';
    if (attempted >= parseUtcMilliseconds(record.expiresAt)) return 'expired';
    return 'active';
  }

  function authorityTemporalWindowFingerprint(record, deniedAttemptedAt) {
    return sha256Canonical({
      deniedAttemptedAt,
      domain: 'rentcore.canonical_actual_posting.temporal_window',
      effectiveFrom: record.effectiveFrom,
      effectiveUntil: record.expiresAt,
      recordHash: record.recordHash,
      recordId: record.recordId,
      recordKind: 'governed_authority',
      version: 1,
    });
  }

  function authorityScopeFingerprint(record) {
    return sha256Canonical({
      branchId: record.branchId,
      companyId: record.companyId,
      domain: 'rentcore.canonical_actual_posting.authority_scope',
      version: 1,
    });
  }

  function authorityDenialSide({
    common,
    record,
    latestRecordHash,
    stateCode,
    expected,
    ownershipManifestHash,
    runtimeIdentity = null,
  }) {
    const effectiveIdentity = expected && runtimeIdentity ? runtimeIdentity : record;
    return {
      actorId: record.actorId,
      artifactIdentityHash: computeArtifactIdentityHash(effectiveIdentity),
      authorityId: record.authorityId,
      authorityKind: record.authorityKind,
      authorityRecordId: record.recordId,
      authorityVersion: record.authorityVersion,
      bindingState: 'valid',
      configurationHash: effectiveIdentity.configurationHash,
      denialAttemptId: common.denialAttemptId,
      deniedAttemptedAt: common.deniedAttemptedAt,
      effectiveFrom: record.effectiveFrom,
      effectiveUntil: record.expiresAt,
      latestRecordHash,
      ownershipManifestHash,
      policyHash: effectiveIdentity.policyHash,
      postingAuthorityChainSnapshotHash: common.postingAuthorityChainSnapshotHash,
      producerAuthorityChainSnapshotHash: common.producerAuthorityChainSnapshotHash,
      recordHash: record.recordHash,
      scopeFingerprint: authorityScopeFingerprint(record),
      sourceAuthorityChainSnapshotHash: common.sourceAuthorityChainSnapshotHash,
      stateCode,
      status: expected ? 'authorized' : record.status,
      temporalEvaluationState: expected ? 'active' : authorityTemporalState(record, common.deniedAttemptedAt),
      temporalWindowFingerprint: authorityTemporalWindowFingerprint(record, common.deniedAttemptedAt),
    };
  }

  function createUnaffectedAuthoritySnapshots(context, denialAttemptId, deniedAttemptedAt) {
    const result = {};
    for (const [kind, key] of [
      ['source_adapter', 'source'],
      ['eligibility_producer', 'producer'],
      ['canonical_posting_adapter', 'posting'],
    ]) {
      const authorityState = context.authorityStates.find(state => state.authorityKind === kind);
      if (!authorityState) {
        throw repositoryError(ERROR_CODES.AUTHORITY_FROZEN_DENIAL_INTEGRITY_FAILED);
      }
      result[key] = createFrozenAuthorityChainSnapshot({
        authorityRows: authorityState.chain,
        candidates: [],
        denialAttemptId,
        deniedAttemptedAt,
        precedenceState: 'unaffected_active_latest',
      });
    }
    return Object.freeze(result);
  }

  function nonAuthorityCommonProjection(context, snapshots, denialAttemptId, deniedAttemptedAt) {
    return {
      denialAttemptId,
      deniedAttemptedAt,
      postingAdapterAuthorityBranchId: context.postingAuthority.branchId,
      postingAdapterAuthorityCompanyId: context.postingAuthority.companyId,
      postingAdapterAuthorityKind: context.postingAuthority.authorityKind,
      postingAdapterAuthorityRecordHash: context.postingAuthority.recordHash,
      postingAdapterAuthorityRecordId: context.postingAuthority.recordId,
      postingAdapterAuthorityVersion: context.postingAuthority.authorityVersion,
      postingAuthorityChainSnapshotHash: snapshots.posting.hash,
      producerAuthorityBranchId: context.producerAuthority.branchId,
      producerAuthorityCompanyId: context.producerAuthority.companyId,
      producerAuthorityKind: context.producerAuthority.authorityKind,
      producerAuthorityRecordHash: context.producerAuthority.recordHash,
      producerAuthorityRecordId: context.producerAuthority.recordId,
      producerAuthorityVersion: context.producerAuthority.authorityVersion,
      producerAuthorityChainSnapshotHash: snapshots.producer.hash,
      sourceAuthorityChainSnapshotHash: snapshots.source.hash,
    };
  }

  function buildNonAuthorityConflictPackage({
    conflictType,
    context,
    denialAttemptId,
    deniedAttemptedAt,
    derived,
    eventHash = null,
    eventId = null,
    existingOperationId = null,
    existingReceivableId = null,
    expectedSpecific,
    observedSpecific,
  }) {
    const snapshots = createUnaffectedAuthoritySnapshots(context, denialAttemptId, deniedAttemptedAt);
    const common = nonAuthorityCommonProjection(context, snapshots, denialAttemptId, deniedAttemptedAt);
    const expectedProjection = { ...common, ...expectedSpecific };
    const observedProjection = { ...common, ...observedSpecific };
    const contracts = buildConflictContracts({
      conflictType,
      denialAttemptId,
      deniedAttemptedAt,
      expectedProjection,
      observedProjection,
    });
    const attemptedEvent = derived.event;
    const conflictCandidateProjection = {
      acceptedDryRunsHash: context.authorization.acceptedDryRunsHash,
      acceptedPr8EvidenceHash: context.authorization.acceptedPr8EvidenceHash,
      activationRecordHash: context.activation.recordHash,
      activationRecordId: context.activation.recordId,
      branchId: attemptedEvent.branchId,
      companyId: attemptedEvent.companyId,
      conflictObservationHash: contracts.conflictObservationHash,
      conflictType,
      detectorVersion: 'canonical-posting-conflict-detector-v1',
      deniedAuthorityKind: null,
      deniedAuthorityRecordHash: null,
      deniedAuthorityRecordId: null,
      deniedAuthorityVersion: null,
      denialAttemptId,
      deniedAttemptedAt,
      economicLineageCandidateFingerprint: derived.economicLineageCandidateFingerprint,
      economicLineageKey: attemptedEvent.economicLineageKey,
      economicSourceRevisionKey: attemptedEvent.economicSourceRevisionKey,
      eventHash,
      eventId,
      existingOperationId,
      existingReceivableId,
      expectedFingerprint: contracts.expectedFingerprint,
      observedFingerprint: contracts.observedFingerprint,
      postingAdapterAuthorityBranchId: context.postingAuthority.branchId,
      postingAdapterAuthorityCompanyId: context.postingAuthority.companyId,
      postingAdapterAuthorityKind: context.postingAuthority.authorityKind,
      postingAdapterAuthorityRecordHash: context.postingAuthority.recordHash,
      postingAdapterAuthorityRecordId: context.postingAuthority.recordId,
      postingAdapterAuthorityVersion: context.postingAuthority.authorityVersion,
      postingAuthorityChainSnapshotHash: snapshots.posting.hash,
      producerAuthorityBranchId: context.producerAuthority.branchId,
      producerAuthorityCompanyId: context.producerAuthority.companyId,
      producerAuthorityKind: context.producerAuthority.authorityKind,
      producerAuthorityRecordHash: context.producerAuthority.recordHash,
      producerAuthorityRecordId: context.producerAuthority.recordId,
      producerAuthorityVersion: context.producerAuthority.authorityVersion,
      producerAuthorityChainSnapshotHash: snapshots.producer.hash,
      schemaVersion: 1,
      sourceAdapterAuthorityRecordHash: context.sourceAuthority.recordHash,
      sourceAdapterAuthorityRecordId: context.sourceAuthority.recordId,
      sourceAdapterAuthorityVersion: context.sourceAuthority.authorityVersion,
      sourceLineageHash: attemptedEvent.sourceLineageHash,
      sourceAuthorityChainSnapshotHash: snapshots.source.hash,
      sourceOwnershipManifestHash: context.authorization.sourceOwnershipManifestHash,
      writeAuthorizationRecordHash: context.authorization.recordHash,
      writeAuthorizationRecordId: context.authorization.recordId,
    };
    return Object.freeze({
      conflictType,
      packageValue: freezeDenialPackageForRepository({
        conflictCandidateProjection,
        conflictType,
        denialAttemptId,
        deniedAttemptedAt,
        expectedProjection,
        observedProjection,
        sourceAuthorityChainSnapshot: snapshots.source,
        producerAuthorityChainSnapshot: snapshots.producer,
        postingAuthorityChainSnapshot: snapshots.posting,
        reconstructionSelectors: {
          activationRecordId: context.requestedActivationRecordId,
          candidateId: context.candidate.id,
          dryRunId: context.run.id,
          writeAuthorizationRecordId: context.requestedWriteAuthorizationRecordId,
        },
      }),
    });
  }

  function buildAuthorityConflictPackage({ context, derived, denialAttemptId, deniedAttemptedAt }) {
    const winner = context.authorityDenial;
    if (!winner) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    const stateByKind = new Map(context.authorityStates.map(state => [state.authorityKind, state]));
    const snapshots = new Map();
    for (const state of context.authorityStates) {
      let precedenceState = 'unaffected_active_latest';
      if (state.candidates.length > 0) {
        precedenceState = state.authorityKind === winner.authorityKind
          ? 'selected'
          : 'suppressed_by_higher_kind';
      }
      snapshots.set(state.authorityKind, createFrozenAuthorityChainSnapshot({
        authorityRows: state.chain,
        candidates: state.candidates,
        denialAttemptId,
        deniedAttemptedAt,
        precedenceState,
      }));
    }
    const sourceSnapshot = snapshots.get('source_adapter');
    const producerSnapshot = snapshots.get('eligibility_producer');
    const postingSnapshot = snapshots.get('canonical_posting_adapter');
    const selectedState = stateByKind.get(winner.authorityKind);
    const observedRecord = selectedState.chain.find(
      row => row.recordId === winner.candidate.authorityRecordId,
    );
    if (!observedRecord) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    const prefix = {
      source_adapter: 'SOURCE_ADAPTER',
      eligibility_producer: 'ELIGIBILITY_PRODUCER',
      canonical_posting_adapter: 'CANONICAL_POSTING_ADAPTER',
    }[winner.authorityKind];
    const conflictType = `${prefix}_${winner.candidate.stateCode}`;
    const commonProjection = {
      denialAttemptId,
      deniedAttemptedAt,
      postingAuthorityChainSnapshotHash: postingSnapshot.hash,
      producerAuthorityChainSnapshotHash: producerSnapshot.hash,
      sourceAuthorityChainSnapshotHash: sourceSnapshot.hash,
    };
    const expectedProjection = authorityDenialSide({
      common: commonProjection,
      record: selectedState.authority,
      latestRecordHash: selectedState.authority.recordHash,
      stateCode: winner.candidate.stateCode,
      expected: true,
      ownershipManifestHash: context.authorization.sourceOwnershipManifestHash,
      runtimeIdentity: context.runtimeContract.authorities[winner.authorityKind],
    });
    const observedProjection = authorityDenialSide({
      common: commonProjection,
      record: observedRecord,
      latestRecordHash: selectedState.latest.recordHash,
      stateCode: winner.candidate.stateCode,
      expected: false,
      ownershipManifestHash: observedRecord.sourceOwnershipManifestHash,
    });
    const contracts = buildConflictContracts({
      conflictType,
      denialAttemptId,
      deniedAttemptedAt,
      expectedProjection,
      observedProjection,
    });
    const attemptedEvent = derived.event;
    const conflictCandidateProjection = {
      acceptedDryRunsHash: context.authorization.acceptedDryRunsHash,
      acceptedPr8EvidenceHash: context.authorization.acceptedPr8EvidenceHash,
      activationRecordHash: context.activation.recordHash,
      activationRecordId: context.activation.recordId,
      branchId: attemptedEvent.branchId,
      companyId: attemptedEvent.companyId,
      conflictObservationHash: contracts.conflictObservationHash,
      conflictType,
      detectorVersion: 'canonical-posting-conflict-detector-v1',
      deniedAuthorityKind: observedRecord.authorityKind,
      deniedAuthorityRecordHash: observedRecord.recordHash,
      deniedAuthorityRecordId: observedRecord.recordId,
      deniedAuthorityVersion: observedRecord.authorityVersion,
      denialAttemptId,
      deniedAttemptedAt,
      economicLineageCandidateFingerprint: derived.economicLineageCandidateFingerprint,
      economicLineageKey: attemptedEvent.economicLineageKey,
      economicSourceRevisionKey: attemptedEvent.economicSourceRevisionKey,
      eventHash: null,
      eventId: null,
      existingOperationId: null,
      existingReceivableId: null,
      expectedFingerprint: contracts.expectedFingerprint,
      observedFingerprint: contracts.observedFingerprint,
      postingAdapterAuthorityBranchId: context.postingAuthority.branchId,
      postingAdapterAuthorityCompanyId: context.postingAuthority.companyId,
      postingAdapterAuthorityKind: context.postingAuthority.authorityKind,
      postingAdapterAuthorityRecordHash: context.postingAuthority.recordHash,
      postingAdapterAuthorityRecordId: context.postingAuthority.recordId,
      postingAdapterAuthorityVersion: context.postingAuthority.authorityVersion,
      postingAuthorityChainSnapshotHash: postingSnapshot.hash,
      producerAuthorityBranchId: context.producerAuthority.branchId,
      producerAuthorityCompanyId: context.producerAuthority.companyId,
      producerAuthorityKind: context.producerAuthority.authorityKind,
      producerAuthorityRecordHash: context.producerAuthority.recordHash,
      producerAuthorityRecordId: context.producerAuthority.recordId,
      producerAuthorityVersion: context.producerAuthority.authorityVersion,
      producerAuthorityChainSnapshotHash: producerSnapshot.hash,
      schemaVersion: 1,
      sourceAdapterAuthorityRecordHash: context.sourceAuthority.recordHash,
      sourceAdapterAuthorityRecordId: context.sourceAuthority.recordId,
      sourceAdapterAuthorityVersion: context.sourceAuthority.authorityVersion,
      sourceLineageHash: attemptedEvent.sourceLineageHash,
      sourceAuthorityChainSnapshotHash: sourceSnapshot.hash,
      sourceOwnershipManifestHash: context.authorization.sourceOwnershipManifestHash,
      writeAuthorizationRecordHash: context.authorization.recordHash,
      writeAuthorizationRecordId: context.authorization.recordId,
    };
    return Object.freeze({
      conflictType,
      packageValue: freezeDenialPackageForRepository({
        conflictCandidateProjection,
        conflictType,
        denialAttemptId,
        deniedAttemptedAt,
        expectedProjection,
        observedProjection,
        sourceAuthorityChainSnapshot: sourceSnapshot,
        producerAuthorityChainSnapshot: producerSnapshot,
        postingAuthorityChainSnapshot: postingSnapshot,
        reconstructionSelectors: {
          activationRecordId: context.requestedActivationRecordId,
          candidateId: context.candidate.id,
          dryRunId: context.run.id,
          writeAuthorizationRecordId: context.requestedWriteAuthorizationRecordId,
        },
      }),
    });
  }

  function buildEventConflictPackage({
    attemptedEvent,
    existingEvent,
    economicLineageCandidateFingerprint,
    context,
    denialAttemptId,
    deniedAttemptedAt,
  }) {
    const existingCandidate = db.prepare(`
      SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} WHERE id = ? AND runId = ?
    `).get(existingEvent.candidateId, existingEvent.dryRunId);
    if (!existingCandidate) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    const currentReplacement = reconstructReplacementRelation(db, context.candidate);
    const sealedReplacement = reconstructReplacementRelation(db, existingCandidate);
    const existingOperation = db.prepare(`
      SELECT id, canonicalReceivableId
      FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}
      WHERE eventId = ?
    `).get(existingEvent.id);
    if (existingOperation) {
      const receivable = db.prepare(`
        SELECT id, companyId, branchId, sourceSystem, sourceLineId
        FROM ${CANONICAL_RECEIVABLES_TABLE} WHERE id = ?
      `).get(existingOperation.canonicalReceivableId);
      if (
        !receivable
        || receivable.companyId !== attemptedEvent.companyId
        || receivable.branchId !== attemptedEvent.branchId
      ) throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
    }
    const revisionIdFields = [
      ['conductedUpdVersionId', 'currentConductedUpdVersionId'],
      ['coverageSetId', 'coverageSetId'],
      ['coverageSliceId', 'coverageSliceId'],
      ['formedUpdVersionId', 'formedUpdVersionId'],
      ['updLineVersionId', 'updLineVersionId'],
    ];
    const sameRevisionIds = revisionIdFields.every(([eventField, candidateField]) => (
      existingEvent[eventField] === context.candidate[candidateField]
    ));
    const revisionChanged = existingEvent.economicSourceRevisionKey !== attemptedEvent.economicSourceRevisionKey;
    const hasValidReplacement = currentReplacement.relations.some(relation => (
      relation.predecessorCoverageSetId === existingEvent.coverageSetId
      || relation.replacementCoverageSetId === context.candidate.coverageSetId
    ));
    let conflictType = 'ECONOMIC_SOURCE_EVENT_MISMATCH';
    let expectedSpecific = {
      economicLineageKey: attemptedEvent.economicLineageKey,
      economicSourceRevisionKey: attemptedEvent.economicSourceRevisionKey,
      eventHash: attemptedEvent.eventHash,
      eventId: existingEvent.id,
    };
    let observedSpecific = {
      economicLineageKey: existingEvent.economicLineageKey,
      economicSourceRevisionKey: existingEvent.economicSourceRevisionKey,
      eventHash: existingEvent.eventHash,
      eventId: existingEvent.id,
    };
    if (revisionChanged && existingOperation) {
      conflictType = 'SOURCE_CORRECTION_AFTER_POSTING';
      expectedSpecific = {
        canonicalReceivableId: existingOperation.canonicalReceivableId,
        currentSourceRevisionKey: existingEvent.economicSourceRevisionKey,
        economicLineageKey: existingEvent.economicLineageKey,
        eventId: existingEvent.id,
        eventSourceRevisionKey: existingEvent.economicSourceRevisionKey,
        replacementRelationHash: sealedReplacement.replacementRelationHash,
      };
      observedSpecific = {
        canonicalReceivableId: existingOperation.canonicalReceivableId,
        currentSourceRevisionKey: attemptedEvent.economicSourceRevisionKey,
        economicLineageKey: attemptedEvent.economicLineageKey,
        eventId: existingEvent.id,
        eventSourceRevisionKey: existingEvent.economicSourceRevisionKey,
        replacementRelationHash: currentReplacement.replacementRelationHash,
      };
    } else if (revisionChanged && !sameRevisionIds && hasValidReplacement) {
      conflictType = 'SOURCE_CORRECTION_AFTER_ELIGIBILITY';
      expectedSpecific = {
        currentSourceRevisionKey: existingEvent.economicSourceRevisionKey,
        economicLineageKey: existingEvent.economicLineageKey,
        eventId: existingEvent.id,
        eventSourceRevisionKey: existingEvent.economicSourceRevisionKey,
        replacementRelationHash: sealedReplacement.replacementRelationHash,
      };
      observedSpecific = {
        currentSourceRevisionKey: attemptedEvent.economicSourceRevisionKey,
        economicLineageKey: attemptedEvent.economicLineageKey,
        eventId: existingEvent.id,
        eventSourceRevisionKey: existingEvent.economicSourceRevisionKey,
        replacementRelationHash: currentReplacement.replacementRelationHash,
      };
    } else if (sameRevisionIds && existingEvent.currentPr6RevisionHash !== attemptedEvent.currentPr6RevisionHash) {
      conflictType = 'SOURCE_REVISION_CHANGED_BEFORE_POSTING';
      expectedSpecific = {
        currentPr6RevisionHash: existingEvent.currentPr6RevisionHash,
        currentSourceRevisionKey: existingEvent.economicSourceRevisionKey,
        economicLineageKey: existingEvent.economicLineageKey,
        eventId: existingEvent.id,
        sealedPr6RevisionHash: existingEvent.currentPr6RevisionHash,
        sealedSourceRevisionKey: existingEvent.economicSourceRevisionKey,
      };
      observedSpecific = {
        currentPr6RevisionHash: attemptedEvent.currentPr6RevisionHash,
        currentSourceRevisionKey: attemptedEvent.economicSourceRevisionKey,
        economicLineageKey: attemptedEvent.economicLineageKey,
        eventId: existingEvent.id,
        sealedPr6RevisionHash: existingEvent.currentPr6RevisionHash,
        sealedSourceRevisionKey: existingEvent.economicSourceRevisionKey,
      };
    } else if (existingEvent.sourceLineageHash !== attemptedEvent.sourceLineageHash) {
      conflictType = 'PR6_LINEAGE_DRIFT';
      expectedSpecific = { sourceLineageHash: existingEvent.sourceLineageHash };
      observedSpecific = { sourceLineageHash: attemptedEvent.sourceLineageHash };
    }
    return buildNonAuthorityConflictPackage({
      conflictType,
      context,
      denialAttemptId,
      deniedAttemptedAt,
      derived: { event: attemptedEvent, economicLineageCandidateFingerprint },
      eventHash: existingEvent.eventHash,
      eventId: existingEvent.id,
      existingOperationId: existingOperation?.id ?? null,
      existingReceivableId: existingOperation?.canonicalReceivableId ?? null,
      expectedSpecific,
      observedSpecific,
    });
  }

  function produceEligibleEvent(commandInput) {
    const command = assertEligibilityCommand(commandInput);
    if (!runtimeContract.enabled) throw repositoryError('CANONICAL_PR9A_DISABLED');
    let blockedScope = null;
    let denial = null;
    beginImmediate(db);
    try {
      if (incompleteTransitions(db, command.companyId, command.branchId).length > 0) {
        blockedScope = { companyId: command.companyId, branchId: command.branchId };
        rollbackQuietly(db);
      } else {
        const clock = readRepositoryClock();
        const floor = monotonicFloor(db, command.companyId, command.branchId);
        if (floor !== null && clock.milliseconds < floor) {
          throw repositoryError('CANONICAL_OPERATIONAL_CLOCK_REGRESSION');
        }
        const denialAttemptId = generateDenialAttemptId();
        const existingAttempt = db.prepare(`
          SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE} WHERE denialAttemptId = ?
        `).get(denialAttemptId);
        if (existingAttempt) {
          try {
            verifyPersistedConflictPair(db, authorityRepository, existingAttempt);
          } catch {
            throw repositoryError(ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED);
          }
          throw repositoryError(ERROR_CODES.DENIAL_ATTEMPT_ID_COLLISION);
        }
        const context = loadAcceptedContext(
          db,
          authorityRepository,
          command,
          clock.milliseconds,
          runtimeContract,
        );
        const replayCandidate = db.prepare(`
          SELECT * FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
          WHERE dryRunId = ? AND candidateId = ?
        `).get(command.dryRunId, command.candidateId);
        if (
          !context.authorityDenial
          && !context.nonAuthorityDenial
          && !context.operationalFailureCode
          && replayCandidate
        ) {
          const persisted = validateEligibleEventRecord(normalizeEventRow(replayCandidate));
          const replay = deriveEventCore(db, context, {
            correlationId: persisted.correlationId,
            occurredAt: persisted.createdAt,
          });
          if (exactRowsEqual(persisted, { id: persisted.id, ...replay.event })) {
            db.exec('COMMIT');
            return Object.freeze({ event: persisted, replayed: true });
          }
        }
        if (context.authorityDenial) {
          denial = buildAuthorityConflictPackage({
            context,
            derived: deriveAuthorityDenialBasis(db, context),
            denialAttemptId,
            deniedAttemptedAt: clock.timestamp,
          });
          rollbackQuietly(db);
        } else {
          if (!context.nonAuthorityDenial && context.operationalFailureCode) {
            throw repositoryError(context.operationalFailureCode);
          }
          const provisionalBasis = deriveAuthorityDenialBasis(db, context);
          const provisionalCorrelationId = deriveRepositoryId(
            'rentcore.canonical_actual_posting.eligibility_correlation_identity',
            {
              branchId: command.branchId,
              companyId: command.companyId,
              denialAttemptId,
              economicLineageCandidateFingerprint:
                provisionalBasis.economicLineageCandidateFingerprint,
            },
          );
          const sourceLineageDenial = context.nonAuthorityDenial
            && NON_AUTHORITY_RECONSTRUCTION_REGISTRY[context.nonAuthorityDenial.conflictType]
              === 'source_lineage';
          const provisional = sourceLineageDenial
            ? provisionalBasis
            : deriveEventCore(db, context, {
              correlationId: provisionalCorrelationId,
              occurredAt: clock.timestamp,
            });
          if (context.nonAuthorityDenial) {
            denial = buildNonAuthorityConflictPackage({
              conflictType: context.nonAuthorityDenial.conflictType,
              context,
              denialAttemptId,
              deniedAttemptedAt: clock.timestamp,
              derived: provisional,
              expectedSpecific: context.nonAuthorityDenial.expectedSpecific,
              observedSpecific: context.nonAuthorityDenial.observedSpecific,
            });
            rollbackQuietly(db);
          } else {
          assertLifecycleSnapshotUnchanged(db, context);
          const locatedRows = [];
          const queries = [
            db.prepare(`
              SELECT * FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
              WHERE companyId = ? AND branchId = ? AND economicLineageKey = ?
            `).get(command.companyId, command.branchId, provisional.event.economicLineageKey),
            db.prepare(`
              SELECT * FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
              WHERE companyId = ? AND branchId = ? AND economicSourceRevisionKey = ?
            `).get(command.companyId, command.branchId, provisional.event.economicSourceRevisionKey),
            db.prepare(`
              SELECT * FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
              WHERE dryRunId = ? AND candidateId = ?
            `).get(command.dryRunId, command.candidateId),
          ];
          for (const row of queries) {
            if (row && !locatedRows.some(existing => existing.id === row.id)) {
              locatedRows.push(normalizeEventRow(row));
            }
          }
          if (locatedRows.length > 1) throw repositoryError('CANONICAL_ELIGIBILITY_REPLAY_INTEGRITY_FAILED');
          if (locatedRows.length === 1) {
            const persisted = validateEligibleEventRecord(locatedRows[0]);
            const replay = deriveEventCore(db, context, {
              correlationId: persisted.correlationId,
              occurredAt: persisted.createdAt,
            });
            const expected = { id: persisted.id, ...replay.event };
            if (exactRowsEqual(persisted, expected)) {
              db.exec('COMMIT');
              return Object.freeze({ event: persisted, replayed: true });
            }
            denial = buildEventConflictPackage({
              attemptedEvent: provisional.event,
              existingEvent: persisted,
              economicLineageCandidateFingerprint: provisional.economicLineageCandidateFingerprint,
              context,
              denialAttemptId,
              deniedAttemptedAt: clock.timestamp,
            });
            rollbackQuietly(db);
          } else {
            const identityInput = {
              branchId: command.branchId,
              companyId: command.companyId,
              denialAttemptId,
              economicLineageCandidateFingerprint: provisional.economicLineageCandidateFingerprint,
              economicSourceRevisionKey: provisional.event.economicSourceRevisionKey,
              sourceLineageHash: provisional.event.sourceLineageHash,
            };
            const eventId = deriveRepositoryId(
              'rentcore.canonical_actual_posting.eligibility_event_identity',
              identityInput,
            );
            const correlationId = deriveRepositoryId(
              'rentcore.canonical_actual_posting.eligibility_correlation_identity',
              identityInput,
            );
            const derived = deriveEventCore(db, context, { correlationId, occurredAt: clock.timestamp });
            const byHash = db.prepare(`
              SELECT * FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
              WHERE companyId = ? AND eventHash = ?
            `).get(command.companyId, derived.event.eventHash);
            if (byHash) {
              const persisted = validateEligibleEventRecord(normalizeEventRow(byHash));
              denial = buildEventConflictPackage({
                attemptedEvent: derived.event,
                existingEvent: persisted,
                economicLineageCandidateFingerprint: derived.economicLineageCandidateFingerprint,
                context,
                denialAttemptId,
                deniedAttemptedAt: clock.timestamp,
              });
              rollbackQuietly(db);
            } else {
              if (db.prepare(`SELECT 1 FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE} WHERE id = ?`).get(eventId)) {
                throw repositoryError('CANONICAL_REPOSITORY_ID_COLLISION');
              }
              assertLifecycleSnapshotUnchanged(db, context);
              const row = { id: eventId, ...derived.event };
              insertExact(
                db,
                ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
                row,
                REQUIRED_COLUMNS[ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE],
              );
              const persisted = readEventById(eventId);
              const refreshedContext = loadAcceptedContext(
                db,
                authorityRepository,
                command,
                clock.milliseconds,
                runtimeContract,
              );
              if (
                refreshedContext.authorityDenial
                || refreshedContext.nonAuthorityDenial
                || refreshedContext.operationalFailureCode
              ) {
                throw repositoryError('CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED');
              }
              const reconstructed = deriveEventCore(db, refreshedContext, {
                correlationId,
                occurredAt: clock.timestamp,
              });
              if (!persisted || !exactRowsEqual(persisted, { id: eventId, ...reconstructed.event })) {
                throw repositoryError('CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED');
              }
              const lineageCount = Number(db.prepare(`
                SELECT COUNT(*) AS count FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
                WHERE companyId = ? AND branchId = ? AND economicLineageKey = ?
              `).get(command.companyId, command.branchId, persisted.economicLineageKey).count);
              const revisionCount = Number(db.prepare(`
                SELECT COUNT(*) AS count FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
                WHERE companyId = ? AND branchId = ? AND economicSourceRevisionKey = ?
              `).get(command.companyId, command.branchId, persisted.economicSourceRevisionKey).count);
              const candidateCount = Number(db.prepare(`
                SELECT COUNT(*) AS count FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
                WHERE dryRunId = ? AND candidateId = ?
              `).get(command.dryRunId, command.candidateId).count);
              if (lineageCount !== 1 || revisionCount !== 1 || candidateCount !== 1) {
                throw repositoryError('CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED');
              }
              db.exec('COMMIT');
              return Object.freeze({ event: persisted, replayed: false });
            }
          }
          }
        }
      }
    } catch (error) {
      rollbackQuietly(db);
      if (
        error instanceof CanonicalActualPostingError
        || String(error?.code || '').startsWith('SQLITE_BUSY')
        || String(error?.code || '').startsWith('SQLITE_LOCKED')
      ) mapAndThrow(error);
      throw repositoryError('CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED');
    }
    if (blockedScope) {
      try {
        reconcileScope(blockedScope);
      } catch {
        // This invocation remains blocked even when synchronous recovery succeeds.
      }
      throw repositoryError(ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED);
    }
    if (denial) {
      const persisted = persistDenialEvidence(denial.packageValue);
      const error = repositoryError(denial.conflictType);
      error.conflict = persisted.conflict;
      error.replayed = persisted.replayed;
      throw error;
    }
    throw repositoryError('CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED');
  }

  return Object.freeze({
    persistDenialEvidence,
    produceEligibleEvent,
    readConflictPair,
    readEventById,
    reconcileScope,
    reconcileTransition,
  });
}

module.exports = {
  ELIGIBILITY_COMMAND_KEYS,
  createCanonicalActualEligibilityEventRepository,
};
