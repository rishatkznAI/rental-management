const { randomUUID } = require('crypto');
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
  BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE,
  BILLING_SOURCE_UPD_VERSIONS_TABLE,
} = require('./billing-source-authority-schema');
const {
  ACTUAL_SOURCE_DRY_RUNS_TABLE,
  ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE,
  ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE,
} = require('./actual-source-eligibility-dry-run-schema');
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
  computeConflictHash,
  computeCoverageLineageRootId,
  computeDueDatePolicySetHash,
  computeEconomicLineageCandidateFingerprint,
  computeEconomicLineageKey,
  computeEconomicSourceRevisionKey,
  computeEligibleEventHash,
  computeSourceLineageHash,
  createFrozenAuthorityChainSnapshot,
  createPendingConflictTransition,
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
const repositoryRowUuidV4 = randomUUID;
const repositoryClockReadUtcMilliseconds = Date.now.bind(Date);

const frozenDenialPackages = new WeakSet();

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

function generateRepositoryId(prefix) {
  let value;
  try {
    value = repositoryRowUuidV4();
    assertUuidV4(value, `${prefix}Uuid`);
  } catch {
    throw repositoryError('CANONICAL_REPOSITORY_ID_GENERATION_FAILED');
  }
  return `${prefix}-${value}`;
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
      const value = row[column.name];
      if (
        value !== null
        && typeof value !== 'string'
        && !(typeof value === 'number' && Number.isSafeInteger(value))
      ) throw repositoryError('CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID');
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
  const selected = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < all.length; index += 1) {
      if (selected.has(index)) continue;
      const entry = all[index];
      const related = entry.columns.some(column => (
        (column === 'id' || column.endsWith('Id'))
        && typeof entry.row[column] === 'string'
        && known.has(entry.row[column])
      ));
      if (!related) continue;
      selected.add(index);
      changed = true;
      for (const column of entry.columns) {
        if (
          (column === 'id' || column.endsWith('Id'))
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

function loadAcceptedContext(db, authorityRepository, command, attemptedAt) {
  const authorization = authorityRepository.readWriteAuthorizationRecord(command.writeAuthorizationRecordId);
  const activation = authorityRepository.readActivationRecord(command.activationRecordId);
  if (!authorization || !activation) throw repositoryError('CANONICAL_AUTHORIZATION_MISSING');
  if (
    authorization.companyId !== command.companyId
    || authorization.branchId !== command.branchId
    || activation.companyId !== command.companyId
    || activation.branchId !== command.branchId
    || activation.writeAuthorizationRecordId !== authorization.recordId
    || activation.recordId !== command.activationRecordId
    || authorization.activationBoundaryId !== activation.activationBoundaryId
    || authorization.cohortHash !== activation.cohortHash
    || authorization.boundaryHash !== activation.boundaryHash
    || authorization.acceptedDryRunsHash !== activation.acceptedDryRunsHash
    || authorization.acceptedPr8EvidenceHash !== activation.acceptedPr8EvidenceHash
    || authorization.acceptedFreshnessWindowsHash !== activation.acceptedFreshnessWindowsHash
    || authorization.dueDatePolicySetHash !== activation.dueDatePolicySetHash
    || authorization.dueDatePolicySetJson !== activation.dueDatePolicySetJson
    || activation.boundaryEndUtc !== null
  ) throw repositoryError('CANONICAL_ACTIVATION_DRIFT');
  assertActiveWindow(authorization, attemptedAt, 'CANONICAL_AUTHORIZATION_DRIFT');
  assertActiveWindow(activation, attemptedAt, 'CANONICAL_ACTIVATION_DRIFT');

  const run = db.prepare(`SELECT * FROM ${ACTUAL_SOURCE_DRY_RUNS_TABLE} WHERE id = ?`).get(command.dryRunId);
  const candidate = db.prepare(`
    SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} WHERE id = ? AND runId = ?
  `).get(command.candidateId, command.dryRunId);
  if (!run || !candidate || run.companyId !== command.companyId || run.branchId !== command.branchId) {
    throw repositoryError('CANONICAL_PR8_EVIDENCE_MISMATCH');
  }
  if (
    candidate.companyId !== command.companyId
    || candidate.branchId !== command.branchId
    || run.status !== 'completed'
    || candidate.status !== 'eligible_candidate'
    || Number(run.diagnosticOnly) !== 1
    || Number(run.canonicalWriteAuthorized) !== 0
    || Number(run.productionActivationAuthorized) !== 0
    || Number(candidate.diagnosticOnly) !== 1
    || Number(candidate.canonicalWriteAuthorized) !== 0
    || Number(candidate.productionActivationAuthorized) !== 0
    || candidate.policyManifestHash !== run.policyManifestHash
  ) throw repositoryError('CANONICAL_PR8_EVIDENCE_MISMATCH');

  const reconciliations = db.prepare(`
    SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_RECONCILIATIONS_TABLE}
    WHERE runId = ? ORDER BY candidateId, dimensionKind, id
  `).all(run.id);
  if (
    reconciliations.length !== Number(run.candidateCount) * 6
    || reconciliations.some(row => (
      Number(row.deltaNetMinor) !== 0
      || Number(row.deltaVatMinor) !== 0
      || Number(row.deltaGrossMinor) !== 0
      || Number(row.blockerState) !== 0
    ))
  ) throw repositoryError('CANONICAL_PR8_EVIDENCE_MISMATCH');

  const acceptedDryRuns = parseCanonicalJson(authorization.acceptedDryRunsJson, 'acceptedDryRunsJson');
  if (computeAcceptedDryRunsHash(acceptedDryRuns) !== authorization.acceptedDryRunsHash) {
    throw repositoryError('CANONICAL_PR8_EVIDENCE_MISMATCH');
  }
  const acceptedPair = acceptedDryRuns.find(pair => pair.dryRunId === run.id);
  if (!acceptedPair || acceptedPair.resultHash !== run.resultHash) {
    throw repositoryError('CANONICAL_PR8_EVIDENCE_MISMATCH');
  }
  const acceptedRuns = parseCanonicalJson(authorization.acceptedPr8EvidenceJson, 'acceptedPr8EvidenceJson');
  const acceptedPr8Hash = computeAcceptedPr8EvidenceHash({
    acceptedDryRunsHash: authorization.acceptedDryRunsHash,
    acceptedFreshnessWindowsHash: authorization.acceptedFreshnessWindowsHash,
    acceptedRuns,
    evidencePackHash: authorization.evidencePackHash,
  });
  if (acceptedPr8Hash !== authorization.acceptedPr8EvidenceHash) {
    throw repositoryError('CANONICAL_PR8_EVIDENCE_MISMATCH');
  }
  const acceptedRun = acceptedRuns.find(entry => entry.dryRunId === run.id);
  if (
    !acceptedRun
    || acceptedRun.resultHash !== run.resultHash
    || acceptedRun.policyManifestHash !== run.policyManifestHash
    || acceptedRun.sourceInputManifestHash !== run.sourceInputManifestHash
    || acceptedRun.companyTimezoneSnapshot !== run.companyTimezone
    || attemptedAt < parseUtcMilliseconds(acceptedRun.validFrom)
    || attemptedAt >= parseUtcMilliseconds(acceptedRun.validUntilExclusive)
  ) throw repositoryError('CANONICAL_PR8_EVIDENCE_MISMATCH');

  const company = db.prepare(`SELECT * FROM ${CANONICAL_COMPANIES_TABLE} WHERE id = ?`).get(command.companyId);
  if (
    !company
    || company.receivablesTimezone !== run.companyTimezone
    || authorization.acceptedCompanyTimezoneSnapshot !== run.companyTimezone
    || activation.companyTimezoneSnapshot !== run.companyTimezone
  ) throw repositoryError('CANONICAL_COMPANY_TIMEZONE_DRIFT');

  const dueDatePolicySet = parseCanonicalJson(authorization.dueDatePolicySetJson, 'dueDatePolicySetJson');
  if (computeDueDatePolicySetHash(dueDatePolicySet) !== authorization.dueDatePolicySetHash) {
    throw repositoryError('CANONICAL_DUE_DATE_POLICY_DRIFT');
  }
  const selectedDueDate = candidate.dueDateProvenance === 'unknown'
    ? dueDatePolicySet.unknownDueDateTreatment
    : dueDatePolicySet.contractualDueDate;
  if (
    candidate.dueDateProvenance !== 'unknown'
    && selectedDueDate.expectedSourceRef !== candidate.dueDateProvenance
  ) throw repositoryError('CANONICAL_DUE_DATE_POLICY_DRIFT');

  const sourceAuthority = authorityRepository.readAuthorityRecord(authorization.sourceAdapterAuthorityRecordId);
  const producerAuthority = authorityRepository.readAuthorityRecord(authorization.producerAuthorityRecordId);
  const postingAuthority = authorityRepository.readAuthorityRecord(authorization.postingAdapterAuthorityRecordId);
  if (!sourceAuthority || !producerAuthority || !postingAuthority) {
    throw repositoryError(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  }
  for (const authority of [sourceAuthority, producerAuthority, postingAuthority]) {
    const latest = authorityRepository.readLatestAuthority(authority);
    if (!latest || latest.recordId !== authority.recordId) throw repositoryError('CANONICAL_AUTHORITY_LATEST_CHAIN_MISMATCH');
    assertActiveWindow(authority, attemptedAt, 'CANONICAL_AUTHORITY_TEMPORAL_DENIAL');
    if (
      authority.companyId !== command.companyId
      || authority.branchId !== command.branchId
      || authority.sourceOwnershipManifestHash !== authorization.sourceOwnershipManifestHash
    ) throw repositoryError('CANONICAL_AUTHORITY_SCOPE_OR_OWNERSHIP_MISMATCH');
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

  return Object.freeze({
    acceptedRun,
    activation,
    authorization,
    candidate,
    dueDatePolicySet,
    postingAuthority,
    producerAuthority,
    run,
    selectedDueDate,
    sourceAuthority,
  });
}

function deriveEventCore(db, context, { correlationId, occurredAt }) {
  const { authorization, activation, candidate, run, selectedDueDate, sourceAuthority, producerAuthority } = context;
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
  const economicLineageCandidateFingerprint = computeEconomicLineageCandidateFingerprint(economicDimensions);
  const pr6LineageRows = reconstructPr6LineageRows(db, candidate);
  const revisionHash = currentPr6RevisionHash(db, candidate, pr6LineageRows);
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
    sourceLineageHash,
    correlationId,
    schemaVersion: 1,
    occurredAt,
    createdAt: occurredAt,
  };
  event.eventHash = computeEligibleEventHash(event);
  return Object.freeze({ event: materializeInert(event), economicLineageCandidateFingerprint });
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

function createCanonicalActualEligibilityEventRepository(db) {
  assertCanonicalActualPostingStructure(db);
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

  function persistDenialEvidence(packageInput) {
    let packageValue;
    let blockedScope = null;
    beginImmediate(db);
    try {
      packageValue = assertFrozenDenialPackage(packageInput);
      const classification = classifyConflictReplay(db, authorityRepository, packageValue);
      if (classification.mode === 'EXACT_REPLAY') {
        db.exec('COMMIT');
        return Object.freeze({ conflict: classification.conflict, replayed: true });
      }
      for (const [snapshot, hash, kind] of [
        [packageValue.sourceAuthorityChainSnapshot, packageValue.sourceAuthorityChainSnapshotHash, 'source_adapter'],
        [packageValue.producerAuthorityChainSnapshot, packageValue.producerAuthorityChainSnapshotHash, 'eligibility_producer'],
        [packageValue.postingAuthorityChainSnapshot, packageValue.postingAuthorityChainSnapshotHash, 'canonical_posting_adapter'],
      ]) authorityRepository.verifyFrozenAuthorityState({ snapshot, snapshotHash: hash, expectedAuthorityKind: kind });
      if (computeConflictHash(packageValue.conflictCandidateProjection) !== packageValue.conflictHashCandidate) {
        throw repositoryError(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
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

        const conflictId = generateRepositoryId('canonical-conflict');
        const correlationId = generateRepositoryId('canonical-correlation');
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

  function buildEventConflictPackage({
    attemptedEvent,
    existingEvent,
    economicLineageCandidateFingerprint,
    context,
    denialAttemptId,
    deniedAttemptedAt,
  }) {
    const sourceSnapshot = createFrozenAuthorityChainSnapshot({
      authorityRows: authorityRepository.readAuthorityChain(context.sourceAuthority),
      candidates: [],
      denialAttemptId,
      deniedAttemptedAt,
      precedenceState: 'unaffected_active_latest',
    });
    const producerSnapshot = createFrozenAuthorityChainSnapshot({
      authorityRows: authorityRepository.readAuthorityChain(context.producerAuthority),
      candidates: [],
      denialAttemptId,
      deniedAttemptedAt,
      precedenceState: 'unaffected_active_latest',
    });
    const postingSnapshot = createFrozenAuthorityChainSnapshot({
      authorityRows: authorityRepository.readAuthorityChain(context.postingAuthority),
      candidates: [],
      denialAttemptId,
      deniedAttemptedAt,
      precedenceState: 'unaffected_active_latest',
    });
    const commonProjection = {
      denialAttemptId,
      deniedAttemptedAt,
      postingAuthorityChainSnapshotHash: postingSnapshot.hash,
      producerAuthorityChainSnapshotHash: producerSnapshot.hash,
      sourceAuthorityChainSnapshotHash: sourceSnapshot.hash,
    };
    const revisionChanged = existingEvent.economicSourceRevisionKey !== attemptedEvent.economicSourceRevisionKey;
    const conflictType = revisionChanged
      ? 'SOURCE_CORRECTION_AFTER_ELIGIBILITY'
      : 'ECONOMIC_SOURCE_EVENT_MISMATCH';
    const expectedProjection = revisionChanged ? {
      ...commonProjection,
      currentPr6RevisionHash: attemptedEvent.currentPr6RevisionHash,
      currentSourceRevisionKey: attemptedEvent.economicSourceRevisionKey,
      economicLineageKey: attemptedEvent.economicLineageKey,
      eventId: existingEvent.id,
      eventPr6RevisionHash: existingEvent.currentPr6RevisionHash,
      eventSourceRevisionKey: existingEvent.economicSourceRevisionKey,
    } : {
      ...commonProjection,
      economicLineageKey: attemptedEvent.economicLineageKey,
      economicSourceRevisionKey: attemptedEvent.economicSourceRevisionKey,
      eventHash: attemptedEvent.eventHash,
      eventId: existingEvent.id,
    };
    const observedProjection = revisionChanged ? {
      ...commonProjection,
      currentPr6RevisionHash: attemptedEvent.currentPr6RevisionHash,
      currentSourceRevisionKey: attemptedEvent.economicSourceRevisionKey,
      economicLineageKey: attemptedEvent.economicLineageKey,
      eventId: existingEvent.id,
      eventPr6RevisionHash: existingEvent.currentPr6RevisionHash,
      eventSourceRevisionKey: existingEvent.economicSourceRevisionKey,
    } : {
      ...commonProjection,
      economicLineageKey: existingEvent.economicLineageKey,
      economicSourceRevisionKey: existingEvent.economicSourceRevisionKey,
      eventHash: existingEvent.eventHash,
      eventId: existingEvent.id,
    };
    if (revisionChanged) {
      expectedProjection.eventPr6RevisionHash = attemptedEvent.currentPr6RevisionHash;
      expectedProjection.eventSourceRevisionKey = attemptedEvent.economicSourceRevisionKey;
    }
    const contracts = buildConflictContracts({
      conflictType,
      denialAttemptId,
      deniedAttemptedAt,
      expectedProjection,
      observedProjection,
    });
    const existingOperation = db.prepare(`
      SELECT id, canonicalReceivableId
      FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}
      WHERE eventId = ?
    `).get(existingEvent.id);
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
      economicLineageCandidateFingerprint,
      economicLineageKey: attemptedEvent.economicLineageKey,
      economicSourceRevisionKey: revisionChanged ? attemptedEvent.economicSourceRevisionKey : existingEvent.economicSourceRevisionKey,
      eventHash: existingEvent.eventHash,
      eventId: existingEvent.id,
      existingOperationId: existingOperation?.id ?? null,
      existingReceivableId: existingOperation?.canonicalReceivableId ?? null,
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
      }),
    });
  }

  function produceEligibleEvent(commandInput) {
    const command = assertEligibilityCommand(commandInput);
    let blockedScope = null;
    let denial = null;
    beginImmediate(db);
    try {
      if (incompleteTransitions(db, command.companyId, command.branchId).length > 0) {
        blockedScope = { companyId: command.companyId, branchId: command.branchId };
        rollbackQuietly(db);
      } else {
        const clock = readRepositoryClock();
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
        const floor = monotonicFloor(db, command.companyId, command.branchId);
        if (floor !== null && clock.milliseconds < floor) {
          throw repositoryError('CANONICAL_OPERATIONAL_CLOCK_REGRESSION');
        }
        const context = loadAcceptedContext(db, authorityRepository, command, clock.milliseconds);
        const provisional = deriveEventCore(db, context, {
          correlationId: 'repository-provisional-correlation',
          occurredAt: clock.timestamp,
        });
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
          const eventId = generateRepositoryId('actual-receivable-eligible');
          const correlationId = generateRepositoryId('actual-receivable-correlation');
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
            const row = { id: eventId, ...derived.event };
            insertExact(
              db,
              ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
              row,
              REQUIRED_COLUMNS[ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE],
            );
            const persisted = readEventById(eventId);
            const refreshedContext = loadAcceptedContext(db, authorityRepository, command, clock.milliseconds);
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
