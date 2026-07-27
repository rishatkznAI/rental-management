const {
  ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
  CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
  CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
  GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE,
  assertCanonicalActualPostingStructure,
} = require('./canonical-actual-posting-schema');
const {
  ERROR_CODES,
  CanonicalActualPostingError,
  activationEnvelope,
  assertGovernedAuthorityRecord,
  assertHash,
  assertIdentifier,
  assertRfc3339Milliseconds,
  assertSafeInteger,
  canonicalJson,
  compareAuthorityDenialCandidate,
  compareSafeIntegerAscending,
  compareUtf16Ascending,
  computeActivationRecordHash,
  computeCanonicalPostingBoundaryHash,
  computeCanonicalPostingCohortHash,
  computeWriteAuthorizationRecordHash,
  createFrozenAuthorityChainSnapshot,
  mapSqliteError,
  materializeInert,
  parseCanonicalJson,
  parseUtcMilliseconds,
  verifyFrozenAuthorityChainSnapshot,
  writeAuthorizationEnvelope,
} = require('./canonical-actual-posting-domain');

const AUTHORITY_KIND_ORDER = Object.freeze([
  'source_adapter',
  'eligibility_producer',
  'canonical_posting_adapter',
]);

const AUTHORITY_SUFFIX_PRECEDENCE = Object.freeze([
  'SCOPE_MISMATCH',
  'RECORD_HASH_MISMATCH',
  'REVOKED',
  'SUPERSEDED',
  'EXPIRED',
  'NOT_YET_EFFECTIVE',
  'ARTIFACT_IDENTITY_DRIFT',
  'CONFIGURATION_HASH_DRIFT',
  'POLICY_HASH_DRIFT',
  'OWNERSHIP_MANIFEST_MISMATCH',
  'LATEST_CHAIN_MISMATCH',
]);

const AUTHORITY_SUFFIX_RANK = new Map(
  AUTHORITY_SUFFIX_PRECEDENCE.map((suffix, index) => [suffix, index]),
);

function repositoryError(code, message = code) {
  return new CanonicalActualPostingError(code, message);
}

function isSqliteConstraint(error) {
  return String(error?.code || '').startsWith('SQLITE_CONSTRAINT');
}

function exactRowEqual(left, right) {
  return canonicalJson(materializeInert(left)) === canonicalJson(materializeInert(right));
}

function authorityOrder(left, right) {
  const version = compareSafeIntegerAscending(Number(left.authorityVersion), Number(right.authorityVersion));
  if (version !== 0) return version;
  return compareUtf16Ascending(left.recordId, right.recordId);
}

function selectGlobalAuthorityDenial(candidateSets) {
  const byKind = new Map();
  for (const entry of candidateSets) {
    if (!AUTHORITY_KIND_ORDER.includes(entry.authorityKind) || byKind.has(entry.authorityKind)) {
      throw repositoryError(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
    }
    const candidates = [...entry.candidates].sort(compareAuthorityDenialCandidate);
    byKind.set(entry.authorityKind, candidates);
  }
  for (const authorityKind of AUTHORITY_KIND_ORDER) {
    const candidates = byKind.get(authorityKind) || [];
    if (candidates.length > 0) return Object.freeze({ authorityKind, candidate: candidates[0] });
  }
  return null;
}

function normalizeDbIntegerFields(row, integerFields) {
  if (!row) return row;
  const result = { ...row };
  for (const field of integerFields) {
    if (result[field] !== null && result[field] !== undefined) result[field] = Number(result[field]);
  }
  return result;
}

function normalizeAuthorityRow(row) {
  return normalizeDbIntegerFields(row, ['authorityVersion', 'schemaVersion']);
}

function normalizeWriteAuthorizationRow(row) {
  return normalizeDbIntegerFields(row, [
    'authorizationVersion', 'sourceAdapterAuthorityVersion', 'producerAuthorityVersion',
    'postingAdapterAuthorityVersion', 'schemaVersion',
  ]);
}

function normalizeActivationRow(row) {
  return normalizeDbIntegerFields(row, [
    'activationVersion', 'postingAdapterAuthorityVersion', 'schemaVersion',
  ]);
}

function parseNormalizedStringArray(value, field, { allowEmpty = false } = {}) {
  const parsed = parseCanonicalJson(value, field);
  if (!Array.isArray(parsed) || (!allowEmpty && parsed.length === 0)) {
    throw repositoryError('CANONICAL_AUTHORITY_LOGICAL_PROJECTION_INVALID');
  }
  if (parsed.some(entry => typeof entry !== 'string' || entry.length === 0)) {
    throw repositoryError('CANONICAL_AUTHORITY_LOGICAL_PROJECTION_INVALID');
  }
  const normalized = [...parsed].sort(compareUtf16Ascending);
  if (
    new Set(normalized).size !== normalized.length
    || canonicalJson(parsed) !== canonicalJson(normalized)
  ) throw repositoryError('CANONICAL_AUTHORITY_LOGICAL_PROJECTION_INVALID');
  return normalized;
}

function localMidnightUtc(dateOnly, timezone) {
  if (typeof dateOnly !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    throw repositoryError('CANONICAL_POSTING_ACTIVATION_INTEGRITY_FAILED');
  }
  const [year, month, day] = dateOnly.split('-').map(Number);
  const calendarProbe = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarProbe.getUTCFullYear() !== year
    || calendarProbe.getUTCMonth() !== month - 1
    || calendarProbe.getUTCDate() !== day
  ) throw repositoryError('CANONICAL_POSTING_ACTIVATION_INTEGRITY_FAILED');
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    if (formatter.resolvedOptions().timeZone !== timezone) {
      throw repositoryError('CANONICAL_POSTING_ACTIVATION_INTEGRITY_FAILED');
    }
  } catch (error) {
    if (error instanceof CanonicalActualPostingError) throw error;
    throw repositoryError('CANONICAL_POSTING_ACTIVATION_INTEGRITY_FAILED');
  }
  const desiredUtc = Date.UTC(year, month - 1, day);
  let candidate = desiredUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]),
    );
    const renderedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const adjustment = desiredUtc - renderedAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  const verification = Object.fromEntries(
    formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]),
  );
  if (
    verification.year !== String(year).padStart(4, '0')
    || verification.month !== String(month).padStart(2, '0')
    || verification.day !== String(day).padStart(2, '0')
    || verification.hour !== '00'
    || verification.minute !== '00'
    || verification.second !== '00'
  ) throw repositoryError('CANONICAL_POSTING_ACTIVATION_INTEGRITY_FAILED');
  return new Date(candidate).toISOString();
}

function assertWriteAuthorizationRecord(record) {
  const row = materializeInert(record, 'writeAuthorization');
  writeAuthorizationEnvelope(row);
  for (const field of [
    'acceptedDryRunsJson', 'acceptedPr8EvidenceJson',
    'primaryEffectTablesJson', 'forbiddenOperationsJson',
  ]) parseCanonicalJson(row[field], field);
  const sourceSystems = parseNormalizedStringArray(row.sourceSystemIdsJson, 'sourceSystemIdsJson');
  if (canonicalJson(sourceSystems) !== canonicalJson(['rentcore.billing_source_authority.v1'])) {
    throw repositoryError('CANONICAL_WRITE_AUTHORIZATION_INTEGRITY_FAILED');
  }
  const policyManifestHashes = parseNormalizedStringArray(
    row.policyManifestHashesJson,
    'policyManifestHashesJson',
  );
  const acceptedRuns = parseCanonicalJson(row.acceptedPr8EvidenceJson, 'acceptedPr8EvidenceJson');
  const acceptedPolicyManifestHashes = [...new Set(
    Array.isArray(acceptedRuns)
      ? acceptedRuns.map(entry => entry?.policyManifestHash).filter(value => typeof value === 'string')
      : [],
  )].sort(compareUtf16Ascending);
  if (
    policyManifestHashes.some(hash => !/^[0-9a-f]{64}$/.test(hash))
    || canonicalJson(policyManifestHashes) !== canonicalJson(acceptedPolicyManifestHashes)
  ) {
    throw repositoryError('CANONICAL_WRITE_AUTHORIZATION_INTEGRITY_FAILED');
  }
  parseCanonicalJson(row.dueDatePolicySetJson, 'dueDatePolicySetJson');
  parseCanonicalJson(row.approvalSetJson, 'approvalSetJson');
  if (row.recordHash !== computeWriteAuthorizationRecordHash(row)) {
    throw repositoryError('CANONICAL_WRITE_AUTHORIZATION_INTEGRITY_FAILED');
  }
  return row;
}

function assertActivationRecord(record) {
  const row = materializeInert(record, 'activation');
  activationEnvelope(row);
  const sourceSystems = parseNormalizedStringArray(row.sourceSystemIdsJson, 'sourceSystemIdsJson');
  const allowedDocumentClasses = parseNormalizedStringArray(
    row.allowedDocumentClassesJson,
    'allowedDocumentClassesJson',
  );
  const allowedRentalClasses = parseNormalizedStringArray(
    row.allowedRentalClassesJson,
    'allowedRentalClassesJson',
  );
  const explicitExclusions = parseNormalizedStringArray(
    row.explicitExclusionsJson,
    'explicitExclusionsJson',
    { allowEmpty: true },
  );
  const policyManifestHashes = parseNormalizedStringArray(
    row.policyManifestHashesJson,
    'policyManifestHashesJson',
  );
  if (policyManifestHashes.some(hash => !/^[0-9a-f]{64}$/.test(hash))) {
    throw repositoryError('CANONICAL_POSTING_ACTIVATION_INTEGRITY_FAILED');
  }
  if (
    canonicalJson(sourceSystems) !== canonicalJson(['rentcore.billing_source_authority.v1'])
    || canonicalJson(allowedDocumentClasses) !== canonicalJson(['rental_service_upd'])
    || canonicalJson(allowedRentalClasses) !== canonicalJson(['equipment_rental_line'])
    || row.currency !== 'RUB'
    || row.forwardOnlyStartUtc !== localMidnightUtc(
      row.forwardOnlyStartDate,
      row.companyTimezoneSnapshot,
    )
  ) throw repositoryError('CANONICAL_POSTING_ACTIVATION_INTEGRITY_FAILED');
  parseCanonicalJson(row.dueDatePolicySetJson, 'dueDatePolicySetJson');
  const cohortHash = computeCanonicalPostingCohortHash({
    allowedDocumentClasses,
    allowedRentalClasses,
    branchIds: [row.branchId],
    companyId: row.companyId,
    currency: row.currency,
    explicitExclusions,
    forwardOnlyStartDate: row.forwardOnlyStartDate,
    policyManifestHashes,
    sourceSystems,
  });
  const boundaryHash = computeCanonicalPostingBoundaryHash({
    boundaryEndUtc: row.boundaryEndUtc,
    branchIds: [row.branchId],
    companyId: row.companyId,
    companyTimezoneSnapshot: row.companyTimezoneSnapshot,
    currency: row.currency,
    exclusionRules: explicitExclusions,
    forwardOnlyStartDate: row.forwardOnlyStartDate,
    forwardOnlyStartUtc: row.forwardOnlyStartUtc,
    sourceSystems,
  });
  if (row.cohortHash !== cohortHash || row.boundaryHash !== boundaryHash) {
    throw repositoryError('CANONICAL_POSTING_ACTIVATION_INTEGRITY_FAILED');
  }
  if (row.recordHash !== computeActivationRecordHash(row)) {
    throw repositoryError('CANONICAL_POSTING_ACTIVATION_INTEGRITY_FAILED');
  }
  return row;
}

function insertExact(db, table, row) {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => '?').join(', ');
  const statement = db.prepare(`
    INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})
  `);
  statement.run(...keys.map(key => row[key]));
}

function assertAuthorityScope(scope) {
  const inert = materializeInert(scope, 'authorityScope');
  for (const field of ['companyId', 'branchId', 'authorityKind', 'authorityId']) {
    assertIdentifier(inert[field], field);
  }
  if (!AUTHORITY_KIND_ORDER.includes(inert.authorityKind)) {
    throw repositoryError('CANONICAL_AUTHORITY_SCOPE_INVALID');
  }
  return inert;
}

function createCanonicalActualPostingAuthorityRepository(db) {
  assertCanonicalActualPostingStructure(db);

  function readAuthorityRecord(recordId) {
    assertIdentifier(recordId, 'recordId');
    const row = db.prepare(`
      SELECT * FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} WHERE recordId = ?
    `).get(recordId);
    if (!row) return null;
    return assertGovernedAuthorityRecord(normalizeAuthorityRow(row));
  }

  function readAuthorityChain(scope) {
    const exactScope = assertAuthorityScope(scope);
    const rows = db.prepare(`
      SELECT *
      FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
      WHERE companyId = ? AND branchId = ? AND authorityKind = ? AND authorityId = ?
      ORDER BY authorityVersion ASC, recordId ASC
    `).all(
      exactScope.companyId,
      exactScope.branchId,
      exactScope.authorityKind,
      exactScope.authorityId,
    ).map(normalizeAuthorityRow).map(row => assertGovernedAuthorityRecord(row));
    for (let index = 0; index < rows.length; index += 1) {
      const previous = rows[index - 1] || null;
      if (
        rows[index].authorityVersion !== index + 1
        || rows[index].previousRecordId !== (previous?.recordId ?? null)
      ) throw repositoryError(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
    }
    return Object.freeze(rows);
  }

  function readLatestAuthority(scope) {
    const chain = readAuthorityChain(scope);
    return chain.length === 0 ? null : chain[chain.length - 1];
  }

  function appendAuthorityRecord(input) {
    const candidate = assertGovernedAuthorityRecord(materializeInert(input, 'authorityRecord'));
    const transaction = db.transaction(() => {
      const byId = db.prepare(`
        SELECT * FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE} WHERE recordId = ?
      `).get(candidate.recordId);
      const byIdentity = db.prepare(`
        SELECT * FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
        WHERE companyId = ? AND branchId = ? AND authorityKind = ?
          AND authorityId = ? AND authorityVersion = ?
      `).get(
        candidate.companyId,
        candidate.branchId,
        candidate.authorityKind,
        candidate.authorityId,
        candidate.authorityVersion,
      );
      const located = byId || byIdentity;
      if (located) {
        const persisted = assertGovernedAuthorityRecord(normalizeAuthorityRow(located));
        if (exactRowEqual(persisted, candidate)) return { record: persisted, replayed: true };
        throw repositoryError('CANONICAL_AUTHORITY_CONTENT_CONFLICT');
      }
      const chain = readAuthorityChain(candidate);
      const previous = chain[chain.length - 1] || null;
      if (
        candidate.authorityVersion !== chain.length + 1
        || candidate.previousRecordId !== (previous?.recordId ?? null)
      ) throw repositoryError('CANONICAL_AUTHORITY_VERSION_CHAIN_INVALID');
      insertExact(db, GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE, candidate);
      const persisted = readAuthorityRecord(candidate.recordId);
      if (!persisted || !exactRowEqual(persisted, candidate)) {
        throw repositoryError('CANONICAL_AUTHORITY_PERSISTENCE_FAILED');
      }
      return { record: persisted, replayed: false };
    });
    try {
      return transaction.immediate();
    } catch (error) {
      if (error instanceof CanonicalActualPostingError) throw error;
      const mapped = mapSqliteError(error);
      if (mapped !== error) throw mapped;
      if (isSqliteConstraint(error)) throw repositoryError('CANONICAL_AUTHORITY_PERSISTENCE_FAILED');
      throw error;
    }
  }

  function appendVersionedRecord({ input, table, idColumn, versionColumn, normalize, validate, conflictCode }) {
    const candidate = validate(materializeInert(input));
    const transaction = db.transaction(() => {
      const byRecord = db.prepare(`SELECT * FROM ${table} WHERE recordId = ?`).get(candidate.recordId);
      const byVersion = db.prepare(`
        SELECT * FROM ${table} WHERE ${idColumn} = ? AND ${versionColumn} = ?
      `).get(candidate[idColumn], candidate[versionColumn]);
      const located = byRecord || byVersion;
      if (located) {
        const persisted = validate(normalize(located));
        if (exactRowEqual(persisted, candidate)) return { record: persisted, replayed: true };
        throw repositoryError(conflictCode);
      }
      const previous = db.prepare(`
        SELECT * FROM ${table} WHERE ${idColumn} = ? ORDER BY ${versionColumn} DESC LIMIT 1
      `).get(candidate[idColumn]);
      if (
        candidate[versionColumn] !== (previous ? Number(previous[versionColumn]) + 1 : 1)
        || candidate.previousRecordId !== (previous?.recordId ?? null)
      ) throw repositoryError('CANONICAL_AUTHORITY_VERSION_CHAIN_INVALID');
      insertExact(db, table, candidate);
      const persisted = validate(normalize(db.prepare(`SELECT * FROM ${table} WHERE recordId = ?`).get(candidate.recordId)));
      if (!exactRowEqual(persisted, candidate)) throw repositoryError('CANONICAL_AUTHORITY_PERSISTENCE_FAILED');
      return { record: persisted, replayed: false };
    });
    try {
      return transaction.immediate();
    } catch (error) {
      if (error instanceof CanonicalActualPostingError) throw error;
      const mapped = mapSqliteError(error);
      if (mapped !== error) throw mapped;
      if (isSqliteConstraint(error)) throw repositoryError('CANONICAL_AUTHORITY_PERSISTENCE_FAILED');
      throw error;
    }
  }

  function appendWriteAuthorizationRecord(input) {
    return appendVersionedRecord({
      input,
      table: CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE,
      idColumn: 'authorizationId',
      versionColumn: 'authorizationVersion',
      normalize: normalizeWriteAuthorizationRow,
      validate: assertWriteAuthorizationRecord,
      conflictCode: 'CANONICAL_WRITE_AUTHORIZATION_CONTENT_CONFLICT',
    });
  }

  function appendActivationRecord(input) {
    return appendVersionedRecord({
      input,
      table: CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE,
      idColumn: 'activationId',
      versionColumn: 'activationVersion',
      normalize: normalizeActivationRow,
      validate: assertActivationRecord,
      conflictCode: 'CANONICAL_POSTING_ACTIVATION_CONTENT_CONFLICT',
    });
  }

  function readWriteAuthorizationRecord(recordId) {
    assertIdentifier(recordId, 'recordId');
    const row = db.prepare(`
      SELECT * FROM ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE} WHERE recordId = ?
    `).get(recordId);
    return row ? assertWriteAuthorizationRecord(normalizeWriteAuthorizationRow(row)) : null;
  }

  function readActivationRecord(recordId) {
    assertIdentifier(recordId, 'recordId');
    const row = db.prepare(`
      SELECT * FROM ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE} WHERE recordId = ?
    `).get(recordId);
    return row ? assertActivationRecord(normalizeActivationRow(row)) : null;
  }

  function readLatestWriteAuthorization(scope) {
    const inert = materializeInert(scope, 'authorizationScope');
    const row = db.prepare(`
      SELECT * FROM ${CANONICAL_WRITE_AUTHORIZATION_RECORDS_TABLE}
      WHERE companyId = ? AND branchId = ?
      ORDER BY authorizationVersion DESC, recordId ASC LIMIT 1
    `).get(inert.companyId, inert.branchId);
    return row ? assertWriteAuthorizationRecord(normalizeWriteAuthorizationRow(row)) : null;
  }

  function readLatestActivation(scope) {
    const inert = materializeInert(scope, 'activationScope');
    const row = db.prepare(`
      SELECT * FROM ${CANONICAL_POSTING_ACTIVATION_RECORDS_TABLE}
      WHERE companyId = ? AND branchId = ?
      ORDER BY activationVersion DESC, recordId ASC LIMIT 1
    `).get(inert.companyId, inert.branchId);
    return row ? assertActivationRecord(normalizeActivationRow(row)) : null;
  }

  function buildAuthorityCandidates({ chain, binding, attemptedAt }) {
    assertRfc3339Milliseconds(attemptedAt, 'attemptedAt');
    if (!Array.isArray(chain) || chain.length === 0) {
      throw repositoryError(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
    }
    const attempted = parseUtcMilliseconds(attemptedAt);
    const latest = chain[chain.length - 1];
    const bound = chain.find(row => row.recordId === binding.recordId) || null;
    if (!bound) return [];
    const suffixes = [];
    if (bound.companyId !== binding.companyId || bound.branchId !== binding.branchId) suffixes.push('SCOPE_MISMATCH');
    if (bound.recordHash !== binding.recordHash) suffixes.push('RECORD_HASH_MISMATCH');
    if (latest.status === 'revoked') suffixes.push('REVOKED');
    if (latest.status === 'superseded') suffixes.push('SUPERSEDED');
    if (bound.status === 'authorized' && attempted >= parseUtcMilliseconds(bound.expiresAt)) suffixes.push('EXPIRED');
    if (bound.status === 'authorized' && attempted < parseUtcMilliseconds(bound.effectiveFrom)) suffixes.push('NOT_YET_EFFECTIVE');
    if (binding.artifactDigest && binding.artifactDigest !== bound.artifactDigest) suffixes.push('ARTIFACT_IDENTITY_DRIFT');
    if (binding.sourceCommitSha && binding.sourceCommitSha !== bound.sourceCommitSha) suffixes.push('ARTIFACT_IDENTITY_DRIFT');
    if (binding.configurationHash && binding.configurationHash !== bound.configurationHash) suffixes.push('CONFIGURATION_HASH_DRIFT');
    if (binding.policyHash && binding.policyHash !== bound.policyHash) suffixes.push('POLICY_HASH_DRIFT');
    if (binding.sourceOwnershipManifestHash && binding.sourceOwnershipManifestHash !== bound.sourceOwnershipManifestHash) {
      suffixes.push('OWNERSHIP_MANIFEST_MISMATCH');
    }
    if (latest.recordId !== bound.recordId && latest.status === 'authorized') suffixes.push('LATEST_CHAIN_MISMATCH');
    return suffixes.map(suffix => ({
      authorityRecordHash: suffix === 'LATEST_CHAIN_MISMATCH' || ['REVOKED', 'SUPERSEDED'].includes(suffix)
        ? latest.recordHash
        : bound.recordHash,
      authorityRecordId: suffix === 'LATEST_CHAIN_MISMATCH' || ['REVOKED', 'SUPERSEDED'].includes(suffix)
        ? latest.recordId
        : bound.recordId,
      authorityVersion: suffix === 'LATEST_CHAIN_MISMATCH' || ['REVOKED', 'SUPERSEDED'].includes(suffix)
        ? latest.authorityVersion
        : bound.authorityVersion,
      precedenceRank: AUTHORITY_SUFFIX_RANK.get(suffix),
      stateCode: suffix,
    })).sort(compareAuthorityDenialCandidate);
  }

  function freezeAuthorityState({ scope, binding, attemptedAt, denialAttemptId, precedenceState }) {
    const chain = readAuthorityChain(scope);
    const latest = chain[chain.length - 1];
    const bound = chain.find(row => row.recordId === binding.recordId);
    if (
      bound
      && latest
      && latest.recordId !== bound.recordId
      && latest.status === 'expired'
    ) throw repositoryError('AUTHORITY_LATEST_EXPIRED_DESCENDANT_UNREPRESENTABLE_V1');
    const candidates = buildAuthorityCandidates({ chain, binding, attemptedAt });
    return createFrozenAuthorityChainSnapshot({
      authorityRows: chain,
      candidates,
      denialAttemptId,
      deniedAttemptedAt: attemptedAt,
      precedenceState,
    });
  }

  function verifyFrozenAuthorityState({ snapshot, snapshotHash, expectedAuthorityKind }) {
    const value = typeof snapshot === 'string' ? parseCanonicalJson(snapshot) : materializeInert(snapshot);
    const boundary = value.boundary;
    const rows = db.prepare(`
      SELECT * FROM ${GOVERNED_ADAPTER_AUTHORITY_RECORDS_TABLE}
      WHERE companyId = ? AND branchId = ? AND authorityKind = ? AND authorityId = ?
      ORDER BY authorityVersion ASC, recordId ASC
    `).all(
      boundary.companyId,
      boundary.branchId,
      boundary.authorityKind,
      boundary.authorityId,
    ).map(normalizeAuthorityRow);
    return verifyFrozenAuthorityChainSnapshot({
      snapshot: value,
      snapshotHash,
      persistedRows: rows,
      expectedAuthorityKind,
    });
  }

  function assertNoEventRows() {
    const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}`).get().count);
    if (count !== 0) throw repositoryError('CANONICAL_AUTHORITY_APPEND_AFTER_EVENT_FORBIDDEN');
  }

  return Object.freeze({
    appendActivationRecord,
    appendAuthorityRecord,
    appendWriteAuthorizationRecord,
    assertNoEventRows,
    buildAuthorityCandidates,
    freezeAuthorityState,
    readActivationRecord,
    readLatestActivation,
    readLatestWriteAuthorization,
    readAuthorityChain,
    readAuthorityRecord,
    readLatestAuthority,
    readWriteAuthorizationRecord,
    verifyFrozenAuthorityState,
  });
}

module.exports = {
  AUTHORITY_KIND_ORDER,
  AUTHORITY_SUFFIX_PRECEDENCE,
  createCanonicalActualPostingAuthorityRepository,
  selectGlobalAuthorityDenial,
};
