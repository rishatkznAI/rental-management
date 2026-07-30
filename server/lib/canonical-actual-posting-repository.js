const { createHash, randomUUID } = require('node:crypto');
const {
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
} = require('./canonical-receivables-schema');
const {
  BILLING_SOURCE_UPD_VERSIONS_TABLE,
} = require('./billing-source-authority-schema');
const {
  ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
  CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
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
  assertUuidV4,
  canonicalJson,
  canonicalPrimaryAuditPayloadProjection,
  canonicalPrimaryResultProjection,
  computeCanonicalPostingAuditEventFingerprint,
  computeCanonicalPostingAuditPayloadFingerprint,
  computeCanonicalPostingCommandFingerprint,
  computeCanonicalPostingIdempotencyKey,
  computeCanonicalPostingResultHash,
  computeCanonicalReceivableFingerprint,
  mapSqliteError,
  normalizeCanonicalPostingCommand,
  parseCanonicalJson,
  renderUtcMilliseconds,
  validateEligibleEventRecord,
  verifyCanonicalPrimaryTriplet,
} = require('./canonical-actual-posting-domain');
const {
  createCanonicalActualPostingAuthorityRepository,
} = require('./canonical-actual-posting-authority-repository');
const {
  CANONICAL_ACTUAL_POSTING_INTERNAL,
  createCanonicalActualEligibilityEventRepository,
} = require('./canonical-actual-eligibility-event-repository');

const PRIMARY_WRITE_SET = Object.freeze([
  CANONICAL_RECEIVABLES_TABLE,
  CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
]);
const EMPTY_WRITE_SET = Object.freeze([]);

function repositoryError(code, message = code) {
  return new CanonicalActualPostingError(code, message);
}

const SQLITE_READ_EVIDENCE_BOUNDARY = Symbol.for(
  'rentcore.canonical_actual_posting.sqlite_read_evidence_boundary.v1',
);

function rawDigest(storageClass, bytes) {
  return createHash('sha256')
    .update(storageClass, 'utf8')
    .update(Buffer.from([0]))
    .update(bytes)
    .digest('hex');
}

function safeSqliteValue(value) {
  let bytes;
  let safeScalar;
  let storageClass;
  if (value === null) {
    bytes = Buffer.alloc(0);
    safeScalar = null;
    storageClass = 'null';
  } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    bytes = Buffer.from(value);
    safeScalar = Object.freeze({
      encoding: 'base64-prefix',
      truncated: bytes.length > 128,
      value: bytes.subarray(0, 128).toString('base64'),
    });
    storageClass = 'blob';
  } else if (typeof value === 'string') {
    bytes = Buffer.from(value, 'utf8');
    safeScalar = Object.freeze({
      encoding: 'utf8-base64-prefix',
      truncated: bytes.length > 128,
      value: bytes.subarray(0, 128).toString('base64'),
    });
    storageClass = 'text';
  } else if (typeof value === 'bigint') {
    bytes = Buffer.from(value.toString(10), 'ascii');
    safeScalar = value.toString(10);
    storageClass = 'integer';
  } else if (typeof value === 'number') {
    const rendered = Object.is(value, -0) ? '-0' : String(value);
    bytes = Buffer.from(rendered, 'ascii');
    safeScalar = rendered;
    storageClass = Number.isInteger(value) ? 'integer' : 'real';
  } else {
    const rendered = Object.prototype.toString.call(value);
    bytes = Buffer.from(rendered, 'utf8');
    safeScalar = rendered;
    storageClass = 'unexpected';
  }
  return Object.freeze({
    byteLength: bytes.length,
    rawDigest: rawDigest(storageClass, bytes),
    safeScalar,
    storageClass,
  });
}

function safeSqliteRow(row) {
  let entries;
  if (Array.isArray(row)) {
    entries = row.map((value, index) => [String(index), value]);
  } else if (row !== null && typeof row === 'object' && !Buffer.isBuffer(row)) {
    entries = Object.keys(row).map(column => [column, row[column]]);
  } else {
    entries = [['$value', row]];
  }
  const columns = entries.map(([column, value], index) => Object.freeze({
    column,
    index,
    ...safeSqliteValue(value),
  }));
  const identity = columns
    .filter(column => ['id', 'recordId', 'transitionId'].includes(column.column))
    .map(column => Object.freeze({
      column: column.column,
      rawDigest: column.rawDigest,
      safeScalar: column.safeScalar,
      storageClass: column.storageClass,
    }));
  return Object.freeze({ columns: Object.freeze(columns), identity: Object.freeze(identity) });
}

function sqliteReadTables(sql) {
  const source = String(sql);
  const tables = [...source.matchAll(/\b(?:FROM|JOIN)\s+(?:"|`|\[)?([a-z_][a-z0-9_]*)/gi)]
    .map(match => match[1]);
  const pragma = source.match(/\bPRAGMA\s+(?:[a-z_][a-z0-9_]*\.)?(?:table_info|table_xinfo|foreign_key_list)\s*\(\s*(?:"|`|\[)?([a-z_][a-z0-9_]*)/i);
  if (pragma) tables.push(pragma[1]);
  return Object.freeze([...new Set(tables)]);
}

function createSqliteReadEvidenceBoundary(db, recordEvidence) {
  if (db[SQLITE_READ_EVIDENCE_BOUNDARY]) return db;
  function recordSqlRead(sql, value, method) {
    try {
      const rows = method === 'all' || (method === 'pragma' && Array.isArray(value))
        ? value
        : value === undefined ? [] : [value];
      const tables = sqliteReadTables(sql);
      const evidenceRows = Object.freeze(rows.map(safeSqliteRow));
      const statementBytes = Buffer.from(String(sql), 'utf8');
      const statementDigest = rawDigest('sql', statementBytes);
      for (const table of tables.length > 0 ? tables : [null]) {
        recordEvidence(Object.freeze({
          method,
          phase: 'sqlite_raw_read',
          rowCount: evidenceRows.length,
          rows: evidenceRows,
          statementDigest,
          table,
          tables,
        }));
      }
    } catch {
      // Observational capture must preserve the original SQLite/validation outcome.
    }
  }
  const proxy = new Proxy(db, {
    get(target, property) {
      if (property === SQLITE_READ_EVIDENCE_BOUNDARY) return true;
      if (property === 'prepare') {
        return sql => {
          const statement = target.prepare(sql);
          let statementProxy;
          statementProxy = new Proxy(statement, {
            get(statementTarget, statementProperty) {
              const value = Reflect.get(statementTarget, statementProperty, statementTarget);
              if (statementProperty === 'get' || statementProperty === 'all') {
                return (...args) => {
                  const result = value.apply(statementTarget, args);
                  recordSqlRead(sql, result, statementProperty);
                  return result;
                };
              }
              if (['expand', 'pluck', 'raw', 'safeIntegers'].includes(statementProperty)) {
                return (...args) => {
                  value.apply(statementTarget, args);
                  return statementProxy;
                };
              }
              return typeof value === 'function' ? value.bind(statementTarget) : value;
            },
          });
          return statementProxy;
        };
      }
      if (property === 'pragma') {
        return (source, ...args) => {
          const result = target.pragma(source, ...args);
          if (!String(source).includes('=')) recordSqlRead(`PRAGMA ${source}`, result, 'pragma');
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return proxy;
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

function exactJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function commandAssertionComparisons(command, event, activation) {
  return Object.freeze([
    ['assertedEventHash', command.assertedEventHash, event.eventHash],
    ['assertedWriteAuthorizationRecordId', command.assertedWriteAuthorizationRecordId, event.writeAuthorizationRecordId],
    ['requestedActivationRecordId', command.requestedActivationRecordId, event.activationRecordId],
    ['requestedSourceAdapterAuthorityRecordId', command.requestedSourceAdapterAuthorityRecordId, event.sourceAdapterAuthorityRecordId],
    ['requestedPostingAdapterAuthorityRecordId', command.requestedPostingAdapterAuthorityRecordId, activation?.postingAdapterAuthorityRecordId ?? null],
    ['requestedPostingAdapterAuthorityVersion', command.requestedPostingAdapterAuthorityVersion, activation?.postingAdapterAuthorityVersion ?? null],
    ['requestedPostingAdapterAuthorityRecordHash', command.requestedPostingAdapterAuthorityRecordHash, activation?.postingAdapterAuthorityRecordHash ?? null],
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
  dependencies = undefined,
) {
  assertCanonicalActualPostingStructure(db);
  const exactRuntimeContract = assertCanonicalActualPostingRuntimeContract(runtimeContract);
  if (
    dependencies !== undefined
    && (
      dependencies === null
      || typeof dependencies !== 'object'
      || Array.isArray(dependencies)
      || Object.keys(dependencies).some(key => ![
        'clock',
        'evidenceRecorder',
        'hooks',
        'uuid',
      ].includes(key))
    )
  ) throw repositoryError(ERROR_CODES.ENVELOPE_INVALID);
  const clockDependency = dependencies?.clock || Date.now.bind(Date);
  const uuidDependency = dependencies?.uuid || (() => randomUUID({ disableEntropyCache: true }));
  const evidenceRecorder = dependencies?.evidenceRecorder;
  const hooks = dependencies?.hooks;
  if (typeof clockDependency !== 'function' || typeof uuidDependency !== 'function') {
    throw repositoryError(ERROR_CODES.ENVELOPE_INVALID);
  }
  if (evidenceRecorder !== undefined && typeof evidenceRecorder !== 'function') {
    throw repositoryError(ERROR_CODES.ENVELOPE_INVALID);
  }
  if (hooks !== undefined && (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks))) {
    throw repositoryError(ERROR_CODES.ENVELOPE_INVALID);
  }
  function recordEvidence(entry) {
    if (!evidenceRecorder) return;
    try {
      evidenceRecorder(Object.freeze(parseCanonicalJson(canonicalJson(entry), 'evidenceRecord')));
    } catch {
      // Test/audit instrumentation cannot affect the production result.
    }
  }
  function recordRawEvidence(entry) {
    if (!evidenceRecorder) return;
    try {
      evidenceRecorder(entry);
    } catch {
      // Raw audit capture is observational and cannot change production precedence.
    }
  }
  function invokeHook(name, details) {
    const hook = hooks?.[name];
    if (typeof hook === 'function') hook(Object.freeze({ ...details }));
  }
  function readClock() {
    try {
      const milliseconds = clockDependency();
      return Object.freeze({
        milliseconds,
        timestamp: renderUtcMilliseconds(milliseconds),
      });
    } catch {
      throw repositoryError('CANONICAL_REPOSITORY_CLOCK_FAILED');
    }
  }
  function generatePostingId() {
    try {
      const id = uuidDependency();
      assertUuidV4(id, 'postingId');
      return id;
    } catch {
      throw repositoryError(ERROR_CODES.POSTING_ID_GENERATION_FAILED);
    }
  }
  const baseDb = db;
  const eligibilityRepository = createCanonicalActualEligibilityEventRepository(
    baseDb,
    exactRuntimeContract,
    {
      clock: clockDependency,
      evidenceRecorder,
      hooks,
      uuid: uuidDependency,
    },
  );
  if (evidenceRecorder) db = createSqliteReadEvidenceBoundary(baseDb, recordRawEvidence);
  const authorityRepository = createCanonicalActualPostingAuthorityRepository(db);
  const eligibilityInternal = eligibilityRepository[CANONICAL_ACTUAL_POSTING_INTERNAL];
  if (!eligibilityInternal) throw repositoryError(ERROR_CODES.POSTING_INTEGRITY_BLOCKED);

  function loadEvent(command) {
    const row = db.prepare(`
      SELECT * FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
      WHERE id = ? AND companyId = ? AND branchId = ?
    `).get(command.eventId, command.companyId, command.branchId);
    recordEvidence({
      phase: 'posting_event_read',
      table: ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
      rows: row ? [row] : [],
    });
    return row ? validateEligibleEventRecord(normalizeEventRow(row)) : null;
  }

  function readPrimaryCandidates(command, event) {
    const operationRows = db.prepare(`
      SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND (eventId = ? OR economicLineageKey = ?)
      ORDER BY id ASC
    `).all(command.companyId, command.branchId, command.eventId, event?.economicLineageKey ?? '');
    const receivableRows = event ? db.prepare(`
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
    ) : [];
    const operations = operationRows.map(normalizeOperationRow);
    const receivables = receivableRows.map(normalizeReceivableRow);
    const audits = operations.map(operation => db.prepare(`
      SELECT * FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} WHERE id = ?
    `).get(operation.financialAuditEventId)).filter(Boolean);
    recordEvidence({
      phase: 'durable_classification_read',
      table: CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
      rows: operationRows,
    });
    recordEvidence({
      phase: 'durable_classification_read',
      table: CANONICAL_RECEIVABLES_TABLE,
      rows: receivableRows,
    });
    recordEvidence({
      phase: 'durable_classification_read',
      table: FINANCIAL_AUDIT_EVENTS_TABLE,
      rows: audits,
    });
    return Object.freeze({ audits, operations, receivables });
  }

  function readConflictCandidates(command, event) {
    const rows = db.prepare(`
      SELECT * FROM ${CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE}
      WHERE companyId = ? AND branchId = ? AND (eventId = ? OR economicLineageKey = ?)
      ORDER BY id ASC
    `).all(command.companyId, command.branchId, command.eventId, event?.economicLineageKey ?? '');
    recordEvidence({
      phase: 'durable_classification_read',
      table: CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,
      rows,
    });
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

  function verifyPrimaryTriplet({ audit, event, operation, receivable, commandFingerprint }) {
    const authorization = authorityRepository.readWriteAuthorizationRecord(operation.writeAuthorizationRecordId);
    const activation = authorityRepository.readActivationRecord(operation.activationRecordId);
    const conducted = db.prepare(`
      SELECT * FROM ${BILLING_SOURCE_UPD_VERSIONS_TABLE} WHERE id = ?
    `).get(event.conductedUpdVersionId);
    if (!authorization || !activation || !conducted) {
      throw repositoryError(ERROR_CODES.POSTING_INTEGRITY_BLOCKED);
    }
    return verifyCanonicalPrimaryTriplet({
      activation,
      audit,
      authorization,
      commandFingerprint,
      conductedCreatedAt: conducted.createdAt,
      event,
      freshnessWindowFingerprint:
        acceptedFreshnessWindow(authorization, event).freshnessWindowFingerprint,
      operation,
      receivable,
    });
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
          commandFingerprint: operation.commandFingerprint,
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

  function qualifyHistoricalResult(command, event, result, clock) {
    if (result.outcome !== 'EXACT_COMMITTED_RESULT') return result;
    try {
      const admission = eligibilityInternal.verifyPostingAdmission(command, event, clock);
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
    const orphanCanonical = event ? db.prepare(`
      SELECT COUNT(*) AS count FROM ${CANONICAL_RECEIVABLES_TABLE} AS receivable
      LEFT JOIN ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} AS operation
        ON operation.canonicalReceivableId = receivable.id
      WHERE receivable.companyId = ? AND receivable.branchId = ?
        AND receivable.sourceSystem = 'rentcore.billing_source_authority.v1'
        AND receivable.sourceDocumentType = 'rental_service_upd'
        AND receivable.sourceDocumentId = ? AND receivable.sourceLineId = ?
        AND operation.id IS NULL
    `).get(
      command.companyId,
      command.branchId,
      event.rootSourceDocumentLineageId,
      event.economicLineageKey,
    ).count : 0;
    const orphanOperation = db.prepare(`
      SELECT COUNT(*) AS count FROM ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} AS operation
      LEFT JOIN ${CANONICAL_RECEIVABLES_TABLE} AS receivable ON receivable.id = operation.canonicalReceivableId
      LEFT JOIN ${FINANCIAL_AUDIT_EVENTS_TABLE} AS audit ON audit.id = operation.financialAuditEventId
      WHERE operation.companyId = ? AND operation.branchId = ?
        AND (operation.eventId = ? OR operation.economicLineageKey = ?)
        AND (receivable.id IS NULL OR audit.id IS NULL)
    `).get(
      command.companyId,
      command.branchId,
      command.eventId,
      event?.economicLineageKey ?? '',
    ).count;
    const orphanAudit = event ? db.prepare(`
      SELECT COUNT(*) AS count FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} AS audit
      LEFT JOIN ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} AS operation
        ON operation.financialAuditEventId = audit.id
      WHERE audit.companyId = ? AND audit.branchId = ?
        AND audit.eventType = 'canonical_receivable.initial_posted.v1'
        AND audit.correlationId = ?
        AND operation.id IS NULL
    `).get(command.companyId, command.branchId, event.correlationId).count : 0;
    recordEvidence({
      facts: {
        orphanAudit: Number(orphanAudit),
        orphanCanonical: Number(orphanCanonical),
        orphanOperation: Number(orphanOperation),
      },
      phase: 'primary_anti_join',
      tables: [
        CANONICAL_RECEIVABLES_TABLE,
        CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
        FINANCIAL_AUDIT_EVENTS_TABLE,
      ],
    });
    if (
      Number(orphanCanonical) !== 0
      || Number(orphanOperation) !== 0
      || Number(orphanAudit) !== 0
    ) {
      throw repositoryError(ERROR_CODES.POSTING_INTEGRITY_BLOCKED);
    }
  }

  function generateAndAssertUnusedPrimaryIds() {
    const generatedIds = Object.freeze({
      canonicalReceivableId: generatePostingId(),
      operationId: generatePostingId(),
      auditEventId: generatePostingId(),
    });
    if (new Set(Object.values(generatedIds)).size !== 3) {
      throw repositoryError('CANONICAL_REPOSITORY_ID_COLLISION');
    }
    for (const id of Object.values(generatedIds)) {
      for (const table of [
        CANONICAL_RECEIVABLES_TABLE,
        CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
        FINANCIAL_AUDIT_EVENTS_TABLE,
      ]) {
        if (db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) {
          throw repositoryError('CANONICAL_REPOSITORY_ID_COLLISION');
        }
      }
    }
    return generatedIds;
  }

  function createPrimaryTriplet(command, event, commandFingerprint, clock, admission, generatedIds) {
    const { activation, authorization, conducted } = admission;
    const idempotencyKey = computeCanonicalPostingIdempotencyKey({
      activationId: activation.activationId,
      canonicalWriteAuthorizationId: authorization.authorizationId,
      economicLineageKey: event.economicLineageKey,
      economicSourceRevisionKey: event.economicSourceRevisionKey,
      eventHash: event.eventHash,
      operationType: OPERATION_DOMAIN,
    });
    const {
      auditEventId,
      canonicalReceivableId,
      operationId,
    } = generatedIds;
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
    const payloadProjection = canonicalPrimaryAuditPayloadProjection({
      event,
      operation,
      canonicalReceivableFingerprint,
    });
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
    operation.resultHash = computeCanonicalPostingResultHash(canonicalPrimaryResultProjection({
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
      commandFingerprint,
      event,
      operation: rereadOperation,
      receivable: persistedReceivable,
    });
    if (!exactJson(operation, rereadOperation) || !exactJson(audit, rereadAudit) || proof.resultHash !== operation.resultHash) {
      throw repositoryError(ERROR_CODES.POSTING_PERSISTENCE_FAILED);
    }
    invokeHook('beforePrecommitAntiJoin', {
      auditEventId,
      canonicalReceivableId,
      command,
      event,
      operationId,
    });
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
      eligibilityInternal.assertPostingStoragePreflight(command, 'algorithm_b_initial');
      const clock = readClock();
      const event = loadEvent(command);
      assertNoPrimaryOrphans(command, event);
      const durable = resolveExistingResult(command, event, commandFingerprint);
      if (durable) {
        recordEvidence({
          classification: durable.classification,
          normalizedCommand: command,
          phase: 'durable_classification',
        });
        const result = event ? qualifyHistoricalResult(command, event, durable, clock) : durable;
        db.exec('COMMIT');
        return result;
      }
      if (!event) {
        const result = postingResult(ERROR_CODES.POSTING_EVENT_NOT_FOUND, { classification: 'NO_RESULT' });
        db.exec('COMMIT');
        return result;
      }
      const assertionActivation = authorityRepository.readActivationRecord(event.activationRecordId);
      const comparisons = commandAssertionComparisons(command, event, assertionActivation);
      if (comparisons.some(entry => !entry.matches)) {
        const result = assertionMismatchResult(commandFingerprint, comparisons);
        db.exec('COMMIT');
        return result;
      }
      const admission = eligibilityInternal.verifyPostingAdmission(command, event, clock);
      recordEvidence({
        classification: admission.denialCause ? 'DENIED' : 'ADMITTED',
        denialCause: admission.denialCause,
        eventId: event.id,
        phase: 'authoritative_admission',
      });
      if (admission.denialCause) {
        denialCause = admission.denialCause;
        denialAttemptId = generatePostingId();
        rollbackQuietly(db);
      } else {
        const repeated = resolveExistingResult(command, event, commandFingerprint);
        if (repeated) {
          const result = qualifyHistoricalResult(command, event, repeated, clock);
          db.exec('COMMIT');
          return result;
        }
        assertNoPrimaryOrphans(command, event);
        const generatedIds = generateAndAssertUnusedPrimaryIds();
        invokeHook('beforeFinalStoragePreflight', { command, event, generatedIds });
        eligibilityInternal.assertPostingStoragePreflight(command, 'algorithm_b_final_pre_dml');
        let triplet;
        try {
          triplet = createPrimaryTriplet(
            command,
            event,
            commandFingerprint,
            clock,
            admission,
            generatedIds,
          );
        } catch (error) {
          if (error instanceof CanonicalActualPostingError) throw error;
          throw repositoryError(ERROR_CODES.POSTING_PERSISTENCE_FAILED);
        }
        const result = Object.freeze({
          classification: 'NO_RESULT_ADMITTED',
          currentAdmissionStatus: 'CURRENTLY_ADMITTED',
          evidence: publicPrimaryEvidence(triplet.operation),
          historicalPostingOutcome: 'EXACT_COMMITTED_RESULT',
          intendedWriteSet: PRIMARY_WRITE_SET,
          outcome: 'POSTED',
          replayed: false,
        });
        db.exec('COMMIT');
        return result;
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
