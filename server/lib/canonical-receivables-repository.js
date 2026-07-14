const {
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
} = require('./canonical-receivables-schema');

const SENSITIVE_AUDIT_KEY_PATTERN = /(password|passhash|token|secret|credential|api[_-]?key|authorization|cookie|session|webhook)/i;

class CanonicalReceivablesRepositoryError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'CanonicalReceivablesRepositoryError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, message, field) {
  throw new CanonicalReceivablesRepositoryError(code, message, field);
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('REPOSITORY_SCOPE_REQUIRED', `${field} is required.`, field);
  }
  return value.trim();
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    fail('INVALID_REPOSITORY_FIELD', `${field} must be text when supplied.`, field);
  }
  return value.trim();
}

function hasSensitiveKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  return Object.entries(value).some(([key, nested]) => (
    SENSITIVE_AUDIT_KEY_PATTERN.test(key)
    || hasSensitiveKey(nested)
  ));
}

function normalizeAuditJson(value, field) {
  if (value === undefined || value === null) return null;
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    fail('INVALID_AUDIT_JSON', `${field} must contain valid JSON.`, field);
  }
  if (hasSensitiveKey(parsed)) {
    fail('AUDIT_SECRET_REJECTED', `${field} contains a secret-bearing field.`, field);
  }
  try {
    return JSON.stringify(parsed);
  } catch {
    fail('INVALID_AUDIT_JSON', `${field} must be JSON serializable.`, field);
  }
}

function validateTimestamp(value, field) {
  const timestamp = requiredText(value, field);
  if (Number.isNaN(Date.parse(timestamp))) {
    fail('INVALID_AUDIT_TIMESTAMP', `${field} must be a valid timestamp.`, field);
  }
  return timestamp;
}

function createCanonicalReceivablesRepository(db) {
  if (!db || typeof db.prepare !== 'function') {
    fail('DATABASE_REQUIRED', 'A better-sqlite3 database is required.');
  }

  function listReceivables(query = {}) {
    const companyId = requiredText(query.companyId, 'companyId');
    const where = ['companyId = @companyId'];
    const params = { companyId };
    for (const field of ['branchId', 'clientId', 'workflowStatus']) {
      const value = optionalText(query[field], field);
      if (!value) continue;
      where.push(`${field} = @${field}`);
      params[field] = value;
    }
    return db.prepare(`
      SELECT *
      FROM ${CANONICAL_RECEIVABLES_TABLE}
      WHERE ${where.join(' AND ')}
      ORDER BY createdAt, id
    `).all(params);
  }

  function getReceivable(query = {}) {
    const companyId = requiredText(query.companyId, 'companyId');
    const id = requiredText(query.id, 'id');
    return db.prepare(`
      SELECT *
      FROM ${CANONICAL_RECEIVABLES_TABLE}
      WHERE companyId = ? AND id = ?
    `).get(companyId, id) || null;
  }

  function appendFinancialAuditEvent(input = {}) {
    const event = {
      id: requiredText(input.id, 'id'),
      companyId: requiredText(input.companyId, 'companyId'),
      branchId: requiredText(input.branchId, 'branchId'),
      aggregateType: requiredText(input.aggregateType, 'aggregateType'),
      aggregateId: requiredText(input.aggregateId, 'aggregateId'),
      eventType: requiredText(input.eventType, 'eventType'),
      actorId: optionalText(input.actorId, 'actorId'),
      actorType: requiredText(input.actorType, 'actorType'),
      occurredAt: validateTimestamp(input.occurredAt, 'occurredAt'),
      reason: optionalText(input.reason, 'reason'),
      previousValueJson: normalizeAuditJson(input.previousValueJson, 'previousValueJson'),
      newValueJson: normalizeAuditJson(input.newValueJson, 'newValueJson'),
      correlationId: requiredText(input.correlationId, 'correlationId'),
      sourceSystem: requiredText(input.sourceSystem, 'sourceSystem'),
      createdAt: validateTimestamp(input.createdAt, 'createdAt'),
    };
    if (!['user', 'integration', 'system'].includes(event.actorType)) {
      fail('INVALID_AUDIT_ACTOR_TYPE', 'actorType is not approved.', 'actorType');
    }
    if (event.actorType === 'user' && !event.actorId) {
      fail('AUDIT_ACTOR_REQUIRED', 'actorId is required for user audit events.', 'actorId');
    }

    db.prepare(`
      INSERT INTO ${FINANCIAL_AUDIT_EVENTS_TABLE} (
        id,
        companyId,
        branchId,
        aggregateType,
        aggregateId,
        eventType,
        actorId,
        actorType,
        occurredAt,
        reason,
        previousValueJson,
        newValueJson,
        correlationId,
        sourceSystem,
        createdAt
      ) VALUES (
        @id,
        @companyId,
        @branchId,
        @aggregateType,
        @aggregateId,
        @eventType,
        @actorId,
        @actorType,
        @occurredAt,
        @reason,
        @previousValueJson,
        @newValueJson,
        @correlationId,
        @sourceSystem,
        @createdAt
      )
    `).run(event);

    return db.prepare(`
      SELECT *
      FROM ${FINANCIAL_AUDIT_EVENTS_TABLE}
      WHERE companyId = ? AND id = ?
    `).get(event.companyId, event.id);
  }

  return Object.freeze({
    appendFinancialAuditEvent,
    getReceivable,
    listReceivables,
  });
}

module.exports = {
  CanonicalReceivablesRepositoryError,
  createCanonicalReceivablesRepository,
};
