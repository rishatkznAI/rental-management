const {
  FORBIDDEN_BRANCH_IDS,
} = require('./platform-identity-repository');
const {
  BILLING_SOURCE_AUDIT_EVENTS_TABLE,
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
  assertBillingSourceAuthorityStructure,
} = require('./billing-source-authority-schema');
const {
  BillingSourceAuthorityError,
} = require('./billing-source-authority-domain');

const INSPECTION_SCOPES = new WeakSet();
const MAX_LIMIT = 100;

function fail(code, message, field, status = 403) {
  throw new BillingSourceAuthorityError(code, message, field, status);
}

function requiredId(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
    fail('BILLING_SOURCE_INSPECTION_SCOPE_INVALID', `${field} is required.`, field);
  }
  return value.trim();
}

function createBillingSourceInspectionScope({ companyId, branchIds } = {}) {
  const normalizedCompanyId = requiredId(companyId, 'companyId');
  if (!Array.isArray(branchIds) || branchIds.length === 0) {
    fail('BILLING_SOURCE_INSPECTION_SCOPE_INVALID', 'Concrete authorized branch IDs are required.', 'branchIds');
  }
  const normalizedBranchIds = [...new Set(branchIds.map((value, index) => requiredId(value, `branchIds[${index}]`)))].sort();
  if (normalizedBranchIds.some(branchId => FORBIDDEN_BRANCH_IDS.has(branchId.toLowerCase()))) {
    fail('BILLING_SOURCE_INSPECTION_SCOPE_INVALID', 'Wildcard branch scope is forbidden.', 'branchIds');
  }
  const scope = Object.freeze({
    companyId: normalizedCompanyId,
    branchIds: Object.freeze(normalizedBranchIds),
  });
  INSPECTION_SCOPES.add(scope);
  return scope;
}

function createBillingSourceAuthorityReadRepository(db) {
  assertBillingSourceAuthorityStructure(db);

  function scoped(scope) {
    if (!scope || !INSPECTION_SCOPES.has(scope)) {
      fail('BILLING_SOURCE_INSPECTION_SCOPE_REQUIRED', 'A branded internal inspection scope is required.', 'scope');
    }
    const placeholders = scope.branchIds.map(() => '?').join(', ');
    const known = db.prepare(`
      SELECT id
      FROM canonical_branches
      WHERE companyId = ? AND id IN (${placeholders}) AND status = 'active'
      ORDER BY id
    `).all(scope.companyId, ...scope.branchIds).map(row => row.id);
    if (known.length !== scope.branchIds.length) {
      fail('BILLING_SOURCE_INSPECTION_SCOPE_REQUIRED', 'Inspection scope contains an unavailable branch.', 'scope');
    }
    return { placeholders, params: [scope.companyId, ...scope.branchIds] };
  }

  function limitValue(value) {
    const limit = value === undefined ? 50 : value;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      fail('BILLING_SOURCE_INSPECTION_LIMIT_INVALID', `limit must be between 1 and ${MAX_LIMIT}.`, 'limit', 400);
    }
    return limit;
  }

  function one(table, scope, entityId) {
    const query = scoped(scope);
    return db.prepare(`
      SELECT * FROM ${table}
      WHERE companyId = ? AND branchId IN (${query.placeholders}) AND id = ?
    `).get(...query.params, requiredId(entityId, 'id')) || null;
  }

  function list(table, scope, whereSql, whereParams, orderSql, limit) {
    const query = scoped(scope);
    return db.prepare(`
      SELECT * FROM ${table}
      WHERE companyId = ? AND branchId IN (${query.placeholders})
        ${whereSql ? `AND ${whereSql}` : ''}
      ORDER BY ${orderSql}
      LIMIT ?
    `).all(...query.params, ...whereParams, limitValue(limit));
  }

  function inspectRentalLine(scope, rentalLineId, options = {}) {
    const rentalLine = one(BILLING_SOURCE_RENTAL_LINES_TABLE, scope, rentalLineId);
    if (!rentalLine) return null;
    return Object.freeze({
      rentalLine,
      termsVersions: list(
        BILLING_SOURCE_EFFECTIVE_TERMS_TABLE,
        scope,
        'rentalLineId = ?',
        [rentalLine.id],
        'version ASC, id ASC',
        options.limit,
      ),
      periods: list(
        BILLING_SOURCE_PERIODS_TABLE,
        scope,
        'rentalLineId = ?',
        [rentalLine.id],
        'periodStartDate ASC, periodEndDateExclusive ASC, id ASC',
        options.limit,
      ),
    });
  }

  function inspectTermsVersions(scope, rentalLineId, options = {}) {
    return list(
      BILLING_SOURCE_EFFECTIVE_TERMS_TABLE,
      scope,
      'rentalLineId = ?',
      [requiredId(rentalLineId, 'rentalLineId')],
      'version ASC, id ASC',
      options.limit,
    );
  }

  function inspectPeriod(scope, periodId, options = {}) {
    const period = one(BILLING_SOURCE_PERIODS_TABLE, scope, periodId);
    if (!period) return null;
    const versions = list(
      BILLING_SOURCE_PERIOD_VERSIONS_TABLE,
      scope,
      'periodId = ?',
      [period.id],
      'version ASC, id ASC',
      options.limit,
    );
    return Object.freeze({ period, versions });
  }

  function inspectSnapshot(scope, snapshotId, options = {}) {
    const snapshot = one(BILLING_SOURCE_SNAPSHOTS_TABLE, scope, snapshotId);
    if (!snapshot) return null;
    return Object.freeze({
      snapshot,
      evidence: list(
        BILLING_SOURCE_SNAPSHOT_EVIDENCE_TABLE,
        scope,
        'snapshotId = ?',
        [snapshot.id],
        'evidenceType ASC, sourceSystem ASC, sourceId ASC, id ASC',
        options.limit,
      ),
    });
  }

  function inspectUpd(scope, updId, options = {}) {
    const upd = one(BILLING_SOURCE_UPDS_TABLE, scope, updId);
    if (!upd) return null;
    return Object.freeze({
      upd,
      versions: list(
        BILLING_SOURCE_UPD_VERSIONS_TABLE,
        scope,
        'updId = ?',
        [upd.id],
        'version ASC, id ASC',
        options.limit,
      ),
    });
  }

  function inspectUpdLines(scope, updId, options = {}) {
    const upd = one(BILLING_SOURCE_UPDS_TABLE, scope, updId);
    if (!upd) return null;
    const lines = list(
      BILLING_SOURCE_UPD_LINES_TABLE,
      scope,
      'updId = ?',
      [upd.id],
      'sourceLineRef ASC, id ASC',
      options.limit,
    );
    return lines.map(line => Object.freeze({
      line,
      versions: list(
        BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE,
        scope,
        'updLineId = ?',
        [line.id],
        'version ASC, id ASC',
        options.limit,
      ),
    }));
  }

  function inspectCoverageSet(scope, coverageSetId, options = {}) {
    const coverageSet = one(BILLING_SOURCE_COVERAGE_SETS_TABLE, scope, coverageSetId);
    if (!coverageSet) return null;
    return Object.freeze({
      coverageSet,
      slices: list(
        BILLING_SOURCE_COVERAGE_SLICES_TABLE,
        scope,
        'coverageSetId = ?',
        [coverageSet.id],
        'periodId ASC, sliceStartDate ASC, sliceEndDateExclusive ASC, updLineId ASC, id ASC',
        options.limit,
      ),
    });
  }

  function inspectOperation(scope, operationType, idempotencyKey) {
    const query = scoped(scope);
    return db.prepare(`
      SELECT *
      FROM ${BILLING_SOURCE_OPERATIONS_TABLE}
      WHERE companyId = ? AND branchId IN (${query.placeholders})
        AND operationType = ? AND idempotencyKey = ?
    `).get(
      ...query.params,
      requiredId(operationType, 'operationType'),
      requiredId(idempotencyKey, 'idempotencyKey'),
    ) || null;
  }

  function inspectAuditHistory(scope, aggregateType, aggregateId, options = {}) {
    return list(
      BILLING_SOURCE_AUDIT_EVENTS_TABLE,
      scope,
      'aggregateType = ? AND aggregateId = ?',
      [requiredId(aggregateType, 'aggregateType'), requiredId(aggregateId, 'aggregateId')],
      'aggregateVersion ASC, createdAt ASC, id ASC',
      options.limit,
    );
  }

  function listBlockedSourceIntegrity(scope, options = {}) {
    const query = scoped(scope);
    const limit = limitValue(options.limit);
    return db.prepare(`
      SELECT sourceType, sourceId, aggregateId, sourceStatus, blockerReasonCodesJson, createdAt
      FROM (
        SELECT 'snapshot' AS sourceType, id AS sourceId, periodId AS aggregateId,
               sourceIntegrityStatus AS sourceStatus, blockerReasonCodesJson, createdAt,
               companyId, branchId
        FROM ${BILLING_SOURCE_SNAPSHOTS_TABLE}
        WHERE sourceIntegrityStatus = 'blocked'
        UNION ALL
        SELECT 'upd_version', id, updId, sourceIntegrityStatus, blockerReasonCodesJson, createdAt,
               companyId, branchId
        FROM ${BILLING_SOURCE_UPD_VERSIONS_TABLE}
        WHERE sourceIntegrityStatus = 'blocked'
        UNION ALL
        SELECT 'upd_line_version', id, updLineId, sourceIntegrityStatus, blockerReasonCodesJson, createdAt,
               companyId, branchId
        FROM ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE}
        WHERE sourceIntegrityStatus = 'blocked'
        UNION ALL
        SELECT 'coverage_set', id, updId, status, blockerReasonCodesJson, createdAt,
               companyId, branchId
        FROM ${BILLING_SOURCE_COVERAGE_SETS_TABLE}
        WHERE status = 'blocked'
      ) blocked
      WHERE companyId = ? AND branchId IN (${query.placeholders})
      ORDER BY createdAt ASC, sourceType ASC, sourceId ASC
      LIMIT ?
    `).all(...query.params, limit);
  }

  return Object.freeze({
    inspectAuditHistory,
    inspectCoverageSet,
    inspectOperation,
    inspectPeriod,
    inspectRentalLine,
    inspectSnapshot,
    inspectTermsVersions,
    inspectUpd,
    inspectUpdLines,
    listBlockedSourceIntegrity,
  });
}

module.exports = {
  MAX_LIMIT,
  createBillingSourceAuthorityReadRepository,
  createBillingSourceInspectionScope,
};
