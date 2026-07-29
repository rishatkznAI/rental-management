const { randomUUID } = require('node:crypto');
const {
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
} = require('./canonical-receivables-schema');
const {
  BILLING_SOURCE_COVERAGE_SETS_TABLE,
  BILLING_SOURCE_COVERAGE_SLICES_TABLE,
  BILLING_SOURCE_COVERAGE_SUPERSESSIONS_TABLE,
  BILLING_SOURCE_UPD_VERSIONS_TABLE,
} = require('./billing-source-authority-schema');
const {
  ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE,
  ACTUAL_SOURCE_DRY_RUNS_TABLE,
} = require('./actual-source-eligibility-dry-run-schema');
const {
  ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
  CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
  CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
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
  canonicalJson,
  computeCanonicalPostingAuditEventFingerprint,
  computeCanonicalPostingAuditPayloadFingerprint,
  computeCanonicalPostingCommandFingerprint,
  computeCanonicalPostingIdempotencyKey,
  computeCanonicalPostingResultHash,
  computeCanonicalReceivableFingerprint,
  mapSqliteError,
  normalizeCanonicalPostingCommand,
  parseCanonicalJson,
  parseUtcMilliseconds,
  renderUtcMilliseconds,
  validateEligibleEventRecord,
} = require('./canonical-actual-posting-domain');
const {
  createCanonicalActualPostingAuthorityRepository,
} = require('./canonical-actual-posting-authority-repository');
const {
  createCanonicalActualEligibilityEventRepository,
} = require('./canonical-actual-eligibility-event-repository');

const postingClockReadUtcMilliseconds = Date.now.bind(Date);
const postingUuidV4 = randomUUID;

const PRIMARY_WRITE_SET = Object.freeze([
  CANONICAL_RECEIVABLES_TABLE,
  CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
]);
const EMPTY_WRITE_SET = Object.freeze([]);

function repositoryError(code, message = code) {
  return new CanonicalActualPostingError(code, message);
}

function rollbackQuietly(db) {
  try {
    if (db.inTransaction) db.exec('ROLLBACK');
  } catch {
    // Preserve the original failure.
  }
}

function mapAndThrow(error) {
  if (error instanceof CanonicalActualPostingError) throw error;
  const mapped = mapSqliteError(error);
  if (mapped !== error) throw mapped;
  throw new CanonicalActualPostingError(
    ERROR_CODES.POSTING_DATABASE_FAILED,
    ERROR_CODES.POSTING_DATABASE_FAILED,
    null,
    { cause: error },
  );
}

function insertExact(db, table, row, columns = Object.keys(row)) {
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map(column => row[column]));
}

function normalizeEventRow(row) {
  if (!row) return null;
  const result = { ...row };
  for (const field of [
    'eventVersion', 'netAmountMinor', 'vatAmountMinor', 'grossAmountMinor',
    'originalAmountMinor', 'selectedDueDatePolicyVersion',
    'unknownDueDateTreatmentMappingVersion', 'sourceAdapterAuthorityVersion',
    'producerAuthorityVersion', 'schemaVersion',
  ]) if (result[field] !== null && result[field] !== undefined) result[field] = Number(result[field]);
  return result;
}

function normalizeReceivableRow(row) {
  if (!row) return null;
  return {
    ...row,
    originalAmountMinor: Number(row.originalAmountMinor),
    version: Number(row.version),
  };
}

function normalizeOperationRow(row) {
  if (!row) return null;
  const result = { ...row };
  for (const field of [
    'sourceAdapterAuthorityVersion', 'postingAdapterAuthorityVersion',
    'selectedDueDatePolicyVersion', 'unknownDueDateTreatmentMappingVersion',
    'schemaVersion',
  ]) if (result[field] !== null && result[field] !== undefined) result[field] = Number(result[field]);
  return result;
}

function readClock() {
  let value;
  try {
    value = postingClockReadUtcMilliseconds();
    return Object.freeze({ milliseconds: value, timestamp: renderUtcMilliseconds(value) });
  } catch {
    throw repositoryError('CANONICAL_REPOSITORY_CLOCK_FAILED');
  }
}

function generatePostingId() {
  try {
    return postingUuidV4({ disableEntropyCache: true });
  } catch {
    throw repositoryError(ERROR_CODES.POSTING_ID_GENERATION_FAILED);
  }
}

function exactJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function commandAssertionComparisons(command, event) {
  return Object.freeze([
    ['assertedEventHash', command.assertedEventHash, event.eventHash],
    ['assertedWriteAuthorizationRecordId', command.assertedWriteAuthorizationRecordId, event.writeAuthorizationRecordId],
    ['requestedActivationRecordId', command.requestedActivationRecordId, event.activationRecordId],
    ['requestedSourceAdapterAuthorityRecordId', command.requestedSourceAdapterAuthorityRecordId, event.sourceAdapterAuthorityRecordId],
    ['assertedDueDatePolicySetHash', command.assertedDueDatePolicySetHash, event.dueDatePolicySetHash],
    ['assertedSelectedDueDateGateKind', command.assertedSelectedDueDateGateKind, event.selectedDueDateGateKind],
    ['assertedSelectedDueDatePolicyId', command.assertedSelectedDueDatePolicyId, event.selectedDueDatePolicyId],
    ['assertedSelectedDueDatePolicyVersion', command.assertedSelectedDueDatePolicyVersion, event.selectedDueDatePolicyVersion],
    ['assertedSelectedDueDatePolicyHash', command.assertedSelectedDueDatePolicyHash, event.selectedDueDatePolicyHash],
    ['assertedDueDateTreatment', command.assertedDueDateTreatment, event.dueDateTreatment],
    ['assertedUnknownDueDateTreatmentMappingId', command.assertedUnknownDueDateTreatmentMappingId, event.unknownDueDateTreatmentMappingId],
    ['assertedUnknownDueDateTreatmentMappingVersion', command.assertedUnknownDueDateTreatmentMappingVersion, event.unknownDueDateTreatmentMappingVersion],
    ['assertedUnknownDueDateTreatmentMappingHash', command.assertedUnknownDueDateTreatmentMappingHash, event.unknownDueDateTreatmentMappingHash],
  ].map(([field, asserted, authoritative]) => Object.freeze({
    asserted,
    authoritative,
    field,
    matches: asserted === authoritative,
  })));
}

function assertionMismatchResult(commandFingerprint, comparisons) {
  return Object.freeze({
    classification: 'ASSERTION_MISMATCH',
    comparisonEvidence: Object.freeze(comparisons.filter(entry => !entry.matches)),
    intendedWriteSet: EMPTY_WRITE_SET,
    normalizedFingerprint: commandFingerprint,
    outcome: ERROR_CODES.POSTING_ASSERTION_MISMATCH,
    replayed: false,
  });
}

function postingResult(outcome, extras = {}) {
  return Object.freeze({
    intendedWriteSet: EMPTY_WRITE_SET,
    outcome,
    ...extras,
  });
}

function acceptedFreshnessWindow(authorization, event) {
  const evidence = parseCanonicalJson(authorization.acceptedPr8EvidenceJson, 'acceptedPr8EvidenceJson');
  const entry = evidence.find(run => run.dryRunId === event.dryRunId);
  if (!entry) throw repositoryError(ERROR_CODES.POSTING_INTEGRITY_BLOCKED);
  return entry;
}

function resultProjection({
  activation,
  auditEventFingerprint,
  auditPayloadFingerprint,
  authorization,
  canonicalReceivableFingerprint,
  commandFingerprint,
  event,
  freshnessWindowFingerprint,
  idempotencyKey,
  operation,
}) {
  return {
    acceptedDryRunsHash: event.acceptedDryRunsHash,
    acceptedPr8EvidenceHash: event.acceptedPr8EvidenceHash,
    activationId: activation.activationId,
    activationRecordHash: activation.recordHash,
    activationRecordId: activation.recordId,
    attemptedAt: operation.createdAt,
    auditEventFingerprint,
    auditPayloadFingerprint,
    branchId: event.branchId,
    canonicalReceivableFingerprint,
    canonicalReceivableId: operation.canonicalReceivableId,
    commandFingerprint,
    canonicalWriteAuthorizationId: authorization.authorizationId,
    companyId: event.companyId,
    correlationId: event.correlationId,
    currentPr6RevisionHash: event.currentPr6RevisionHash,
    dueDatePolicySetHash: event.dueDatePolicySetHash,
    dueDateTreatment: event.dueDateTreatment,
    economicLineageKey: event.economicLineageKey,
    economicSourceRevisionKey: event.economicSourceRevisionKey,
    eventHash: event.eventHash,
    eventId: event.id,
    financialAuditEventId: operation.financialAuditEventId,
    freshnessWindowFingerprint,
    idempotencyKey,
    operationId: operation.id,
    operationType: operation.operationType,
    postingAdapterAuthorityBranchId: operation.postingAdapterAuthorityBranchId,
    postingAdapterAuthorityCompanyId: operation.postingAdapterAuthorityCompanyId,
    postingAdapterAuthorityKind: operation.postingAdapterAuthorityKind,
    postingAdapterAuthorityRecordHash: operation.postingAdapterAuthorityRecordHash,
    postingAdapterAuthorityRecordId: operation.postingAdapterAuthorityRecordId,
    postingAdapterAuthorityVersion: operation.postingAdapterAuthorityVersion,
    schemaVersion: operation.schemaVersion,
    producerAuthorityBranchId: event.producerAuthorityBranchId,
    producerAuthorityCompanyId: event.producerAuthorityCompanyId,
    producerAuthorityKind: event.producerAuthorityKind,
    producerAuthorityRecordHash: event.producerAuthorityRecordHash,
    producerAuthorityRecordId: event.producerAuthorityRecordId,
    producerAuthorityVersion: event.producerAuthorityVersion,
    selectedDueDateGateKind: event.selectedDueDateGateKind,
    selectedDueDatePolicyHash: event.selectedDueDatePolicyHash,
    selectedDueDatePolicyId: event.selectedDueDatePolicyId,
    selectedDueDatePolicyVersion: event.selectedDueDatePolicyVersion,
    sourceAdapterAuthorityRecordHash: event.sourceAdapterAuthorityRecordHash,
    sourceAdapterAuthorityRecordId: event.sourceAdapterAuthorityRecordId,
    sourceAdapterAuthorityVersion: event.sourceAdapterAuthorityVersion,
    sourceLineageHash: event.sourceLineageHash,
    sourceOwnershipManifestHash: event.sourceOwnershipManifestHash,
    unknownDueDateTreatmentMappingHash: event.unknownDueDateTreatmentMappingHash,
    unknownDueDateTreatmentMappingId: event.unknownDueDateTreatmentMappingId,
    unknownDueDateTreatmentMappingVersion: event.unknownDueDateTreatmentMappingVersion,
    writeAuthorizationRecordHash: authorization.recordHash,
    writeAuthorizationRecordId: authorization.recordId,
  };
}

function auditPayloadProjection({ event, operation, canonicalReceivableFingerprint }) {
  return {
    acceptedDryRunsHash: operation.acceptedDryRunsHash,
    acceptedPr8EvidenceHash: operation.acceptedPr8EvidenceHash,
    activationRecordId: operation.activationRecordId,
    actorAuthorityRecordId: operation.postingAdapterAuthorityRecordId,
    actorIdentityId: 'integration:rentcore-canonical-receivable-posting',
    canonicalReceivableFingerprint,
    dueDatePolicySetHash: operation.dueDatePolicySetHash,
    dueDateTreatment: operation.dueDateTreatment,
    economicLineageKey: operation.economicLineageKey,
    economicSourceRevisionKey: operation.economicSourceRevisionKey,
    eventHash: operation.eventHash,
    eventId: operation.eventId,
    operationId: operation.id,
    postingAdapterAuthorityBranchId: operation.postingAdapterAuthorityBranchId,
    postingAdapterAuthorityCompanyId: operation.postingAdapterAuthorityCompanyId,
    postingAdapterAuthorityKind: operation.postingAdapterAuthorityKind,
    postingAdapterAuthorityRecordHash: operation.postingAdapterAuthorityRecordHash,
    postingAdapterAuthorityRecordId: operation.postingAdapterAuthorityRecordId,
    postingAdapterAuthorityVersion: operation.postingAdapterAuthorityVersion,
    selectedDueDateGateKind: operation.selectedDueDateGateKind,
    selectedDueDatePolicyHash: operation.selectedDueDatePolicyHash,
    selectedDueDatePolicyId: operation.selectedDueDatePolicyId,
    selectedDueDatePolicyVersion: operation.selectedDueDatePolicyVersion,
    sourceAdapterAuthorityRecordHash: operation.sourceAdapterAuthorityRecordHash,
    sourceAdapterAuthorityRecordId: operation.sourceAdapterAuthorityRecordId,
    sourceAdapterAuthorityVersion: operation.sourceAdapterAuthorityVersion,
    sourceLineageHash: operation.sourceLineageHash,
    sourceOwnershipManifestHash: operation.sourceOwnershipManifestHash,
    unknownDueDateTreatmentMappingHash: operation.unknownDueDateTreatmentMappingHash,
    unknownDueDateTreatmentMappingId: operation.unknownDueDateTreatmentMappingId,
    unknownDueDateTreatmentMappingVersion: operation.unknownDueDateTreatmentMappingVersion,
    writeAuthorizationRecordId: operation.writeAuthorizationRecordId,
  };
}

function publicPrimaryEvidence(operation) {
  return Object.freeze({
    auditEventFingerprint: operation.auditEventFingerprint,
    auditPayloadFingerprint: operation.auditPayloadFingerprint,
    canonicalReceivableFingerprint: operation.canonicalReceivableFingerprint,
    canonicalReceivableId: operation.canonicalReceivableId,
    commandFingerprint: operation.commandFingerprint,
    correlationId: operation.correlationId,
    financialAuditEventId: operation.financialAuditEventId,
    idempotencyKey: operation.idempotencyKey,
    operationId: operation.id,
    resultHash: operation.resultHash,
  });
}

function createCanonicalActualPostingRepository(
  db,
  runtimeContract = DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
) {
  assertCanonicalActualPostingStructure(db);
  const exactRuntimeContract = assertCanonicalActualPostingRuntimeContract(runtimeContract);
  const authorityRepository = createCanonicalActualPostingAuthorityRepository(db);
  const eligibilityRepository = createCanonicalActualEligibilityEventRepository(db, exactRuntimeContract);

  function loadEvent(command) {
    const row = db.prepare(`
      SELECT * FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
      WHERE id = ? AND companyId = ? AND branchId = ?
    `).get(command.eventId, command.companyId, command.branchId);
    return row ? validateEligibleEventRecord(normalizeEventRow(row)) : null;
  }

  function readPrimaryCandidates(command, event) {
    const operations = db.prepare(`
      SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND (eventId = ? OR economicLineageKey = ?)
      ORDER BY id ASC
    `).all(command.companyId, command.branchId, command.eventId, event?.economicLineageKey ?? '')
      .map(normalizeOperationRow);
    const receivables = event ? db.prepare(`
      SELECT * FROM ${CANONICAL_RECEIVABLES_TABLE}
      WHERE companyId = ? AND branchId = ?
        AND sourceSystem = 'rentcore.billing_source_authority.v1'
        AND (
          (sourceDocumentType = 'rental_service_upd' AND sourceDocumentId = ? AND sourceLineId = ?)
          OR externalId = ?
        )
      ORDER BY id ASC
    `).all(
      command.companyId,
      command.branchId,
      event.rootSourceDocumentLineageId,
      event.economicLineageKey,
      event.economicLineageKey,
    ).map(normalizeReceivableRow) : [];
    const audits = operations.map(operation => db.prepare(`
      SELECT * FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} WHERE id = ?
    `).get(operation.financialAuditEventId)).filter(Boolean);
    return Object.freeze({ audits, operations, receivables });
  }

  function readConflictCandidates(command, event) {
    const rows = db.prepare(`
      SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE}
      WHERE companyId = ? AND branchId = ? AND (eventId = ? OR economicLineageKey = ?)
      ORDER BY id ASC
    `).all(command.companyId, command.branchId, command.eventId, event?.economicLineageKey ?? '');
    const pairs = [];
    for (const row of rows) {
      try {
        pairs.push(eligibilityRepository.readConflictPair(row.transitionId));
      } catch {
        return Object.freeze({ corrupt: true, pairs: Object.freeze([]) });
      }
    }
    return Object.freeze({ corrupt: false, pairs: Object.freeze(pairs) });
  }

  function verifyPrimaryTriplet({ audit, event, operation, receivable }) {
    const authorization = authorityRepository.readWriteAuthorizationRecord(operation.writeAuthorizationRecordId);
    const activation = authorityRepository.readActivationRecord(operation.activationRecordId);
    if (!authorization || !activation) throw repositoryError(ERROR_CODES.POSTING_INTEGRITY_BLOCKED);
    if (
      operation.eventId !== event.id
      || operation.eventHash !== event.eventHash
      || operation.canonicalReceivableId !== receivable.id
      || operation.financialAuditEventId !== audit.id
      || operation.correlationId !== event.correlationId
      || audit.correlationId !== event.correlationId
      || receivable.sourceDocumentType !== 'rental_service_upd'
      || receivable.sourceDocumentId !== event.rootSourceDocumentLineageId
      || receivable.sourceLineId !== event.economicLineageKey
      || receivable.externalId !== event.economicLineageKey
      || receivable.originalAmountMinor !== event.grossAmountMinor
    ) throw repositoryError(ERROR_CODES.POSTING_INTEGRITY_BLOCKED);
    const canonicalReceivableFingerprint = computeCanonicalReceivableFingerprint(receivable);
    const payload = parseCanonicalJson(audit.newValueJson, 'financialAuditEvent.newValueJson');
    const { auditPayloadFingerprint, ...payloadProjection } = payload;
    const recomputedPayloadFingerprint = computeCanonicalPostingAuditPayloadFingerprint(payloadProjection);
    const auditEventFingerprint = computeCanonicalPostingAuditEventFingerprint({
      audit,
      auditPayloadFingerprint: recomputedPayloadFingerprint,
    });
    const freshnessWindowFingerprint = acceptedFreshnessWindow(authorization, event).freshnessWindowFingerprint;
    const resultHash = computeCanonicalPostingResultHash(resultProjection({
      activation,
      auditEventFingerprint,
      auditPayloadFingerprint: recomputedPayloadFingerprint,
      authorization,
      canonicalReceivableFingerprint,
      commandFingerprint: operation.commandFingerprint,
      event,
      freshnessWindowFingerprint,
      idempotencyKey: operation.idempotencyKey,
      operation,
    }));
    if (
      canonicalReceivableFingerprint !== operation.canonicalReceivableFingerprint
      || recomputedPayloadFingerprint !== auditPayloadFingerprint
      || recomputedPayloadFingerprint !== operation.auditPayloadFingerprint
      || auditEventFingerprint !== operation.auditEventFingerprint
      || resultHash !== operation.resultHash
    ) throw repositoryError(ERROR_CODES.POSTING_INTEGRITY_BLOCKED);
    return Object.freeze({ activation, authorization, resultHash });
  }

  function resolveExistingResult(command, event, commandFingerprint) {
    const primary = readPrimaryCandidates(command, event);
    const conflicts = readConflictCandidates(command, event);
    const primaryPresent = primary.operations.length + primary.receivables.length + primary.audits.length > 0;
    const conflictPresent = conflicts.pairs.length > 0;
    if (
      conflicts.corrupt
      || primary.operations.length > 1
      || primary.receivables.length > 1
      || primary.audits.length > 1
      || (primaryPresent && (
        primary.operations.length !== 1
        || primary.receivables.length !== 1
        || primary.audits.length !== 1
      ))
      || (primaryPresent && conflictPresent)
      || conflicts.pairs.length > 1
    ) return postingResult('PRIMARY_RESULT_INTEGRITY_BLOCKED', { classification: 'PRIMARY_PARTIAL_OR_CORRUPT' });
    if (conflictPresent) {
      const pair = conflicts.pairs[0];
      return postingResult(
        pair.transition.state === 'COMPLETE' ? 'CONFLICT_COMPLETED' : 'CONFLICT_RECOVERY_REQUIRED',
        {
          classification: pair.transition.state === 'COMPLETE'
            ? 'CONFLICT_COMPLETED'
            : 'CONFLICT_RECOVERY_INCOMPLETE',
          evidence: Object.freeze({
            conflictHash: pair.conflict.conflictHash,
            conflictId: pair.conflict.id,
            conflictType: pair.conflict.conflictType,
            denialAttemptId: pair.conflict.denialAttemptId,
            stage: pair.transition.state,
            transitionHash: pair.transition.intentHash,
            transitionId: pair.transition.transitionId,
          }),
          replayed: pair.transition.state === 'COMPLETE',
        },
      );
    }
    if (primaryPresent) {
      const operation = primary.operations[0];
      try {
        verifyPrimaryTriplet({
          audit: primary.audits[0],
          event,
          operation,
          receivable: primary.receivables[0],
        });
      } catch {
        return postingResult('PRIMARY_RESULT_INTEGRITY_BLOCKED', { classification: 'PRIMARY_PARTIAL_OR_CORRUPT' });
      }
      if (operation.commandFingerprint !== commandFingerprint) {
        return postingResult('IDEMPOTENCY_CONTENT_CONFLICT', {
          classification: 'IDENTITY_CONFLICT',
          evidence: publicPrimaryEvidence(operation),
          replayed: false,
        });
      }
      return postingResult('EXACT_COMMITTED_RESULT', {
        classification: 'PRIMARY_POSTED_EXACT',
        currentAdmissionStatus: 'CURRENT_STATUS_PENDING',
        evidence: publicPrimaryEvidence(operation),
        historicalPostingOutcome: 'EXACT_COMMITTED_RESULT',
        replayed: true,
      });
    }
    return null;
  }

  function authorityDenial(prefix, record, attemptedAt) {
    if (!record) return `${prefix}_RECORD_HASH_MISMATCH`;
    const latest = authorityRepository.readLatestAuthority(record);
    if (!latest) return `${prefix}_RECORD_HASH_MISMATCH`;
    if (latest.recordId !== record.recordId) {
      if (latest.status === 'revoked') return `${prefix}_REVOKED`;
      if (latest.status === 'superseded') return `${prefix}_SUPERSEDED`;
      return `${prefix}_LATEST_CHAIN_MISMATCH`;
    }
    if (record.status === 'revoked') return `${prefix}_REVOKED`;
    if (record.status === 'superseded') return `${prefix}_SUPERSEDED`;
    if (attemptedAt < parseUtcMilliseconds(record.effectiveFrom)) return `${prefix}_NOT_YET_EFFECTIVE`;
    if (attemptedAt >= parseUtcMilliseconds(record.expiresAt)) return `${prefix}_EXPIRED`;
    return null;
  }

  function currentAdmission(command, event, clock) {
    const authorization = authorityRepository.readWriteAuthorizationRecord(event.writeAuthorizationRecordId);
    const activation = authorityRepository.readActivationRecord(event.activationRecordId);
    if (!authorization || authorityRepository.readLatestWriteAuthorization(event)?.recordId !== authorization.recordId) {
      return Object.freeze({ denialCause: 'AUTHORIZATION_DRIFT' });
    }
    if (
      authorization.status !== 'authorized'
      || clock.milliseconds < parseUtcMilliseconds(authorization.effectiveFrom)
      || clock.milliseconds >= parseUtcMilliseconds(authorization.expiresAt)
    ) return Object.freeze({ denialCause: 'AUTHORIZATION_DRIFT' });
    if (!activation || authorityRepository.readLatestActivation(event)?.recordId !== activation.recordId) {
      return Object.freeze({ denialCause: 'ACTIVATION_DRIFT' });
    }
    if (
      activation.status !== 'authorized'
      || clock.milliseconds < parseUtcMilliseconds(activation.effectiveFrom)
      || clock.milliseconds >= parseUtcMilliseconds(activation.expiresAt)
      || activation.writeAuthorizationRecordId !== authorization.recordId
    ) return Object.freeze({ denialCause: 'ACTIVATION_DRIFT' });
    const authorityEntries = [
      ['SOURCE_ADAPTER', authorityRepository.readAuthorityRecord(event.sourceAdapterAuthorityRecordId), 'source_adapter'],
      ['ELIGIBILITY_PRODUCER', authorityRepository.readAuthorityRecord(event.producerAuthorityRecordId), 'eligibility_producer'],
      ['CANONICAL_POSTING_ADAPTER', authorityRepository.readAuthorityRecord(activation.postingAdapterAuthorityRecordId), 'canonical_posting_adapter'],
    ];
    for (const [prefix, record, kind] of authorityEntries) {
      const denialCause = authorityDenial(prefix, record, clock.milliseconds);
      if (denialCause) return Object.freeze({ denialCause });
      const expectedRuntime = exactRuntimeContract.authorities[kind];
      if (record.artifactDigest !== expectedRuntime.artifactDigest || record.sourceCommitSha !== expectedRuntime.sourceCommitSha) {
        return Object.freeze({ denialCause: `${prefix}_ARTIFACT_IDENTITY_DRIFT` });
      }
      if (record.configurationHash !== expectedRuntime.configurationHash) {
        return Object.freeze({ denialCause: `${prefix}_CONFIGURATION_HASH_DRIFT` });
      }
      if (record.policyHash !== expectedRuntime.policyHash) {
        return Object.freeze({ denialCause: `${prefix}_POLICY_HASH_DRIFT` });
      }
    }
    const posting = authorityEntries[2][1];
    const comparisons = [
      [authorization.acceptedDryRunsHash, event.acceptedDryRunsHash],
      [authorization.acceptedPr8EvidenceHash, event.acceptedPr8EvidenceHash],
      [authorization.dueDatePolicySetHash, event.dueDatePolicySetHash],
      [activation.acceptedDryRunsHash, event.acceptedDryRunsHash],
      [activation.acceptedPr8EvidenceHash, event.acceptedPr8EvidenceHash],
      [activation.dueDatePolicySetHash, event.dueDatePolicySetHash],
      [posting.recordId, command.requestedPostingAdapterAuthorityRecordId],
      [posting.authorityVersion, command.requestedPostingAdapterAuthorityVersion],
      [posting.recordHash, command.requestedPostingAdapterAuthorityRecordHash],
    ];
    if (comparisons.some(([left, right]) => left !== right)) {
      return Object.freeze({ denialCause: 'ACTIVATION_DRIFT' });
    }
    const company = db.prepare('SELECT receivablesTimezone FROM canonical_companies WHERE id = ?').get(event.companyId);
    if (!company || company.receivablesTimezone !== event.companyTimezoneSnapshot) {
      return Object.freeze({ denialCause: 'COMPANY_TIMEZONE_DRIFT' });
    }
    const run = db.prepare(`SELECT * FROM ${ACTUAL_SOURCE_DRY_RUNS_TABLE} WHERE id = ?`).get(event.dryRunId);
    const candidate = db.prepare(`SELECT * FROM ${ACTUAL_SOURCE_DRY_RUN_CANDIDATES_TABLE} WHERE id = ?`).get(event.candidateId);
    if (
      !run
      || !candidate
      || candidate.resultHash !== event.candidateResultHash
      || (candidate.dueDateEvidenceRef ?? null) !== event.dueDateEvidenceRef
      || candidate.currentConductedUpdVersionId !== event.conductedUpdVersionId
      || candidate.coverageSetId !== event.coverageSetId
      || candidate.coverageSliceId !== event.coverageSliceId
      || Number(candidate.sourceGrossMinor) !== event.grossAmountMinor
    ) {
      return Object.freeze({ denialCause: 'PR8_EVIDENCE_MISMATCH' });
    }
    const freshness = acceptedFreshnessWindow(authorization, event);
    if (
      clock.milliseconds < parseUtcMilliseconds(freshness.validFrom)
      || clock.milliseconds >= parseUtcMilliseconds(freshness.validUntilExclusive)
    ) return Object.freeze({ denialCause: 'PR8_EVIDENCE_MISMATCH' });
    const slice = db.prepare(`SELECT * FROM ${BILLING_SOURCE_COVERAGE_SLICES_TABLE} WHERE id = ?`).get(event.coverageSliceId);
    const set = db.prepare(`SELECT * FROM ${BILLING_SOURCE_COVERAGE_SETS_TABLE} WHERE id = ?`).get(event.coverageSetId);
    const conducted = db.prepare(`SELECT * FROM ${BILLING_SOURCE_UPD_VERSIONS_TABLE} WHERE id = ?`).get(event.conductedUpdVersionId);
    if (!slice || !set || !conducted || set.status !== 'validated' || conducted.state !== 'conducted') {
      return Object.freeze({ denialCause: 'SOURCE_LINEAGE_NO_CURRENT_REVISION' });
    }
    const successors = db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_COVERAGE_SUPERSESSIONS_TABLE}
      WHERE originalCoverageSetId = ? ORDER BY id ASC
    `).all(event.coverageSetId);
    if (successors.length > 0) return Object.freeze({ denialCause: 'SOURCE_CORRECTION_AFTER_ELIGIBILITY' });
    if (
      Number(slice.allocatedGrossMinor) !== event.grossAmountMinor
      || slice.clientId !== event.clientId
      || slice.rentalId !== event.rentalId
      || (slice.contractId ?? null) !== event.contractId
      || slice.dueDateProvenance !== event.dueDateProvenance
      || (slice.contractualDueDate ?? null) !== event.contractualDueDate
    ) return Object.freeze({ denialCause: 'PR6_LINEAGE_DRIFT' });
    return Object.freeze({ activation, authorization, conducted, denialCause: null });
  }

  function qualifyHistoricalResult(command, event, result, clock) {
    if (result.outcome !== 'EXACT_COMMITTED_RESULT') return result;
    try {
      const admission = currentAdmission(command, event, clock);
      return Object.freeze({
        ...result,
        currentAdmissionStatus: admission.denialCause ? 'CURRENTLY_DENIED' : 'CURRENTLY_ADMITTED',
        currentDenialCause: admission.denialCause,
      });
    } catch {
      return Object.freeze({
        ...result,
        currentAdmissionStatus: 'CURRENT_STATUS_INTEGRITY_BLOCKED',
        currentDenialCause: null,
      });
    }
  }

  function assertNoPrimaryOrphans(command, event) {
    const orphanCanonical = db.prepare(`
      SELECT COUNT(*) AS count FROM ${CANONICAL_RECEIVABLES_TABLE} AS receivable
      LEFT JOIN ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} AS operation
        ON operation.canonicalReceivableId = receivable.id
      WHERE receivable.companyId = ? AND receivable.branchId = ?
        AND receivable.sourceSystem = 'rentcore.billing_source_authority.v1'
        AND receivable.sourceDocumentType = 'rental_service_upd'
        AND receivable.sourceDocumentId = ? AND receivable.sourceLineId = ?
        AND operation.id IS NULL
    `).get(command.companyId, command.branchId, event.rootSourceDocumentLineageId, event.economicLineageKey).count;
    const orphanOperation = db.prepare(`
      SELECT COUNT(*) AS count FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} AS operation
      LEFT JOIN ${CANONICAL_RECEIVABLES_TABLE} AS receivable ON receivable.id = operation.canonicalReceivableId
      LEFT JOIN ${FINANCIAL_AUDIT_EVENTS_TABLE} AS audit ON audit.id = operation.financialAuditEventId
      WHERE operation.companyId = ? AND operation.branchId = ? AND operation.eventId = ?
        AND (receivable.id IS NULL OR audit.id IS NULL)
    `).get(command.companyId, command.branchId, event.id).count;
    if (Number(orphanCanonical) !== 0 || Number(orphanOperation) !== 0) {
      throw repositoryError(ERROR_CODES.POSTING_INTEGRITY_BLOCKED);
    }
  }

  function createPrimaryTriplet(command, event, commandFingerprint, clock, admission) {
    const { activation, authorization, conducted } = admission;
    const idempotencyKey = computeCanonicalPostingIdempotencyKey({
      activationId: activation.activationId,
      canonicalWriteAuthorizationId: authorization.authorizationId,
      economicLineageKey: event.economicLineageKey,
      economicSourceRevisionKey: event.economicSourceRevisionKey,
      eventHash: event.eventHash,
      operationType: OPERATION_DOMAIN,
    });
    const canonicalReceivableId = generatePostingId();
    const operationId = generatePostingId();
    const auditEventId = generatePostingId();
    const receivable = {
      id: canonicalReceivableId,
      companyId: event.companyId,
      branchId: event.branchId,
      clientId: event.clientId,
      contractId: event.contractId,
      rentalId: event.rentalId,
      sourceDocumentType: 'rental_service_upd',
      sourceDocumentId: event.rootSourceDocumentLineageId,
      sourceLineId: event.economicLineageKey,
      sourceSystem: 'rentcore.billing_source_authority.v1',
      externalId: event.economicLineageKey,
      idempotencyKey,
      currency: 'RUB',
      originalAmountMinor: event.grossAmountMinor,
      issuedAt: conducted.createdAt,
      postedAt: clock.timestamp,
      contractualDueDate: event.contractualDueDate,
      dueDateProvenance: event.dueDateProvenance,
      companyTimezone: event.companyTimezoneSnapshot,
      workflowStatus: 'posted',
      cancellationReason: null,
      description: 'Governed UPD coverage slice',
      createdAt: clock.timestamp,
      updatedAt: clock.timestamp,
      cancelledAt: null,
      closedAt: null,
      writtenOffAt: null,
      version: 1,
    };
    insertExact(db, CANONICAL_RECEIVABLES_TABLE, receivable);
    const persistedReceivable = normalizeReceivableRow(db.prepare(`
      SELECT * FROM ${CANONICAL_RECEIVABLES_TABLE} WHERE id = ?
    `).get(canonicalReceivableId));
    const canonicalReceivableFingerprint = computeCanonicalReceivableFingerprint(persistedReceivable);
    const operation = {
      id: operationId,
      companyId: event.companyId,
      branchId: event.branchId,
      operationType: OPERATION_DOMAIN,
      idempotencyKey,
      eventId: event.id,
      eventHash: event.eventHash,
      economicLineageKey: event.economicLineageKey,
      economicSourceRevisionKey: event.economicSourceRevisionKey,
      currentPr6RevisionHash: event.currentPr6RevisionHash,
      sourceAdapterAuthorityRecordId: event.sourceAdapterAuthorityRecordId,
      sourceAdapterAuthorityVersion: event.sourceAdapterAuthorityVersion,
      sourceAdapterAuthorityRecordHash: event.sourceAdapterAuthorityRecordHash,
      sourceOwnershipManifestHash: event.sourceOwnershipManifestHash,
      postingAdapterAuthorityRecordId: activation.postingAdapterAuthorityRecordId,
      postingAdapterAuthorityVersion: activation.postingAdapterAuthorityVersion,
      postingAdapterAuthorityRecordHash: activation.postingAdapterAuthorityRecordHash,
      postingAdapterAuthorityCompanyId: activation.postingAdapterAuthorityCompanyId,
      postingAdapterAuthorityBranchId: activation.postingAdapterAuthorityBranchId,
      postingAdapterAuthorityKind: activation.postingAdapterAuthorityKind,
      writeAuthorizationRecordId: authorization.recordId,
      activationRecordId: activation.recordId,
      acceptedDryRunsHash: event.acceptedDryRunsHash,
      acceptedPr8EvidenceHash: event.acceptedPr8EvidenceHash,
      dueDatePolicySetHash: event.dueDatePolicySetHash,
      selectedDueDateGateKind: event.selectedDueDateGateKind,
      selectedDueDatePolicyId: event.selectedDueDatePolicyId,
      selectedDueDatePolicyVersion: event.selectedDueDatePolicyVersion,
      selectedDueDatePolicyHash: event.selectedDueDatePolicyHash,
      dueDateTreatment: event.dueDateTreatment,
      unknownDueDateTreatmentMappingId: event.unknownDueDateTreatmentMappingId,
      unknownDueDateTreatmentMappingVersion: event.unknownDueDateTreatmentMappingVersion,
      unknownDueDateTreatmentMappingHash: event.unknownDueDateTreatmentMappingHash,
      canonicalReceivableId,
      canonicalReceivableFingerprint,
      sourceLineageHash: event.sourceLineageHash,
      commandFingerprint,
      auditPayloadFingerprint: null,
      auditEventFingerprint: null,
      resultHash: null,
      financialAuditEventId: auditEventId,
      correlationId: event.correlationId,
      schemaVersion: 1,
      createdAt: clock.timestamp,
    };
    const payloadProjection = auditPayloadProjection({ event, operation, canonicalReceivableFingerprint });
    const auditPayloadFingerprint = computeCanonicalPostingAuditPayloadFingerprint(payloadProjection);
    const payload = { ...payloadProjection, auditPayloadFingerprint };
    const audit = {
      id: auditEventId,
      companyId: event.companyId,
      branchId: event.branchId,
      aggregateType: 'canonical_receivable',
      aggregateId: canonicalReceivableId,
      eventType: 'canonical_receivable.initial_posted.v1',
      actorId: 'integration:rentcore-canonical-receivable-posting',
      actorType: 'integration',
      occurredAt: clock.timestamp,
      reason: 'canonical_actual_posting_initial_post_v1',
      previousValueJson: null,
      newValueJson: canonicalJson(payload),
      correlationId: event.correlationId,
      sourceSystem: 'rentcore.billing_source_authority.v1',
      createdAt: clock.timestamp,
    };
    const auditEventFingerprint = computeCanonicalPostingAuditEventFingerprint({ audit, auditPayloadFingerprint });
    operation.auditPayloadFingerprint = auditPayloadFingerprint;
    operation.auditEventFingerprint = auditEventFingerprint;
    const freshnessWindowFingerprint = acceptedFreshnessWindow(authorization, event).freshnessWindowFingerprint;
    operation.resultHash = computeCanonicalPostingResultHash(resultProjection({
      activation,
      auditEventFingerprint,
      auditPayloadFingerprint,
      authorization,
      canonicalReceivableFingerprint,
      commandFingerprint,
      event,
      freshnessWindowFingerprint,
      idempotencyKey,
      operation,
    }));
    insertExact(
      db,
      CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
      operation,
      REQUIRED_COLUMNS[CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE],
    );
    insertExact(db, FINANCIAL_AUDIT_EVENTS_TABLE, audit);
    const rereadOperation = normalizeOperationRow(db.prepare(`
      SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} WHERE id = ?
    `).get(operationId));
    const rereadAudit = db.prepare(`SELECT * FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} WHERE id = ?`).get(auditEventId);
    const proof = verifyPrimaryTriplet({
      audit: rereadAudit,
      event,
      operation: rereadOperation,
      receivable: persistedReceivable,
    });
    if (!exactJson(operation, rereadOperation) || !exactJson(audit, rereadAudit) || proof.resultHash !== operation.resultHash) {
      throw repositoryError(ERROR_CODES.POSTING_PERSISTENCE_FAILED);
    }
    assertNoPrimaryOrphans(command, event);
    if (db.pragma('foreign_key_check').length !== 0 || db.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw repositoryError(ERROR_CODES.POSTING_PERSISTENCE_FAILED);
    }
    return Object.freeze({ operation: rereadOperation, receivable: persistedReceivable, audit: rereadAudit });
  }

  function post(commandInput) {
    const command = normalizeCanonicalPostingCommand(commandInput);
    const commandFingerprint = computeCanonicalPostingCommandFingerprint(command);
    if (!exactRuntimeContract.enabled) throw repositoryError(ERROR_CODES.PR9B_DISABLED);
    let denialCause = null;
    let denialAttemptId = null;
    db.exec('BEGIN IMMEDIATE');
    try {
      assertCanonicalActualPostingStructure(db);
      const clock = readClock();
      const event = loadEvent(command);
      const durable = resolveExistingResult(command, event, commandFingerprint);
      if (durable) {
        db.exec('COMMIT');
        return event ? qualifyHistoricalResult(command, event, durable, clock) : durable;
      }
      if (!event) {
        db.exec('COMMIT');
        return postingResult(ERROR_CODES.POSTING_EVENT_NOT_FOUND, { classification: 'NO_RESULT' });
      }
      const comparisons = commandAssertionComparisons(command, event);
      if (comparisons.some(entry => !entry.matches)) {
        db.exec('COMMIT');
        return assertionMismatchResult(commandFingerprint, comparisons);
      }
      assertNoPrimaryOrphans(command, event);
      const admission = currentAdmission(command, event, clock);
      if (admission.denialCause) {
        denialCause = admission.denialCause;
        denialAttemptId = generatePostingId();
        rollbackQuietly(db);
      } else {
        const repeated = resolveExistingResult(command, event, commandFingerprint);
        if (repeated) {
          db.exec('COMMIT');
          return qualifyHistoricalResult(command, event, repeated, clock);
        }
        let triplet;
        try {
          triplet = createPrimaryTriplet(command, event, commandFingerprint, clock, admission);
        } catch (error) {
          if (error instanceof CanonicalActualPostingError) throw error;
          throw repositoryError(ERROR_CODES.POSTING_PERSISTENCE_FAILED);
        }
        db.exec('COMMIT');
        return Object.freeze({
          classification: 'NO_RESULT_ADMITTED',
          currentAdmissionStatus: 'CURRENTLY_ADMITTED',
          evidence: publicPrimaryEvidence(triplet.operation),
          historicalPostingOutcome: 'EXACT_COMMITTED_RESULT',
          intendedWriteSet: PRIMARY_WRITE_SET,
          outcome: 'POSTED',
          replayed: false,
        });
      }
    } catch (error) {
      rollbackQuietly(db);
      mapAndThrow(error);
    }
    return eligibilityRepository.orchestratePostingDenial({
      assertedDenialCause: denialCause,
      denialAttemptId,
      postingCommand: command,
    });
  }

  return Object.freeze({ post });
}

module.exports = {
  PRIMARY_WRITE_SET,
  createCanonicalActualPostingRepository,
};
