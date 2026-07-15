const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
} = require('./canonical-receivables-schema');
const {
  CANONICAL_PAYMENT_ALLOCATIONS_TABLE,
  CANONICAL_PAYMENTS_TABLE,
  CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE,
} = require('./canonical-receivables-settlement-schema');

class CanonicalReceivablesReadRepositoryError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'CanonicalReceivablesReadRepositoryError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, message, field) {
  throw new CanonicalReceivablesReadRepositoryError(code, message, field);
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('READ_SCOPE_REQUIRED', `${field} is required.`, field);
  }
  return value.trim();
}

function normalizeBranchScope(scope = {}) {
  const companyId = requiredText(scope.companyId, 'companyId');
  if (scope.companyWideBranchAccess === true) {
    return { companyId, companyWideBranchAccess: true, branchIds: null };
  }
  const branchIds = Array.isArray(scope.branchIds)
    ? [...new Set(scope.branchIds.map(value => String(value || '').trim()).filter(Boolean))]
    : [];
  if (branchIds.length === 0) {
    fail('READ_BRANCH_SCOPE_REQUIRED', 'A trusted branch scope is required.', 'branchIds');
  }
  return { companyId, companyWideBranchAccess: false, branchIds };
}

function scopedWhere(scope, alias, params, requestedBranchId) {
  const normalized = normalizeBranchScope(scope);
  const prefix = alias ? `${alias}.` : '';
  const where = [`${prefix}companyId = @companyId`];
  params.companyId = normalized.companyId;
  if (requestedBranchId) {
    where.push(`${prefix}branchId = @requestedBranchId`);
    params.requestedBranchId = requestedBranchId;
  } else if (!normalized.companyWideBranchAccess) {
    const placeholders = normalized.branchIds.map((branchId, index) => {
      const key = `branchId${index}`;
      params[key] = branchId;
      return `@${key}`;
    });
    where.push(`${prefix}branchId IN (${placeholders.join(', ')})`);
  }
  return where;
}

function appendReceivableIdScope(where, params, alias, receivableIds) {
  if (!Array.isArray(receivableIds)) return false;
  if (receivableIds.length === 0) return true;
  const placeholders = receivableIds.map((id, index) => {
    const key = `receivableScopeId${index}`;
    params[key] = requiredText(id, 'receivableId');
    return `@${key}`;
  });
  where.push(`${alias}.receivableId IN (${placeholders.join(', ')})`);
  return false;
}

function appendPaymentIdScope(where, params, alias, paymentIds) {
  if (!Array.isArray(paymentIds)) return false;
  if (paymentIds.length === 0) return true;
  const placeholders = paymentIds.map((id, index) => {
    const key = `paymentScopeId${index}`;
    params[key] = requiredText(id, 'paymentId');
    return `@${key}`;
  });
  where.push(`${alias}.paymentId IN (${placeholders.join(', ')})`);
  return false;
}

function createCanonicalReceivablesReadRepository(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail('DATABASE_REQUIRED', 'A better-sqlite3 database is required.');
  }

  const queries = Object.freeze({
    getCompany(scope = {}) {
      const companyId = requiredText(scope.companyId, 'companyId');
      return db.prepare(`
        SELECT id, receivablesTimezone, createdAt
        FROM ${CANONICAL_COMPANIES_TABLE}
        WHERE id = ?
      `).get(companyId) || null;
    },

    listBranches(scope = {}) {
      const companyId = requiredText(scope.companyId, 'companyId');
      return db.prepare(`
        SELECT id
        FROM ${CANONICAL_BRANCHES_TABLE}
        WHERE companyId = ?
        ORDER BY id
      `).all(companyId).map(row => row.id);
    },

    listReceivables(scope = {}, options = {}) {
      const params = {};
      const where = scopedWhere(scope, 'receivable', params, options.branchId);
      if (options.id) {
        where.push('receivable.id = @id');
        params.id = requiredText(options.id, 'id');
      }
      if (options.after) {
        where.push(`(
          receivable.createdAt > @afterCreatedAt
          OR (receivable.createdAt = @afterCreatedAt AND receivable.id > @afterId)
        )`);
        params.afterCreatedAt = requiredText(options.after.createdAt, 'afterCreatedAt');
        params.afterId = requiredText(options.after.id, 'afterId');
      }
      let limitClause = '';
      if (options.limit !== undefined) {
        if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
          fail('INVALID_READ_BATCH_LIMIT', 'Read batch limit must be a positive safe integer.', 'limit');
        }
        params.limit = options.limit;
        limitClause = 'LIMIT @limit';
      }
      return db.prepare(`
        SELECT receivable.*
        FROM ${CANONICAL_RECEIVABLES_TABLE} receivable
        WHERE ${where.join(' AND ')}
        ORDER BY receivable.createdAt ASC, receivable.id ASC
        ${limitClause}
      `).all(params);
    },

    listAllocations(scope = {}, options = {}) {
      const params = {};
      const normalized = normalizeBranchScope(scope);
      const where = ['allocation.companyId = @companyId'];
      params.companyId = normalized.companyId;
      if (options.branchId) {
        where.push('allocation.receivableBranchId = @requestedBranchId');
        params.requestedBranchId = options.branchId;
      } else if (!normalized.companyWideBranchAccess) {
        const placeholders = normalized.branchIds.map((branchId, index) => {
          const key = `allocationBranchId${index}`;
          params[key] = branchId;
          return `@${key}`;
        });
        where.push(`allocation.receivableBranchId IN (${placeholders.join(', ')})`);
      }
      if (options.receivableId) {
        where.push('allocation.receivableId = @receivableId');
        params.receivableId = requiredText(options.receivableId, 'receivableId');
      }
      if (appendReceivableIdScope(where, params, 'allocation', options.receivableIds)) return [];
      return db.prepare(`
        SELECT allocation.*
        FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
        WHERE ${where.join(' AND ')}
        ORDER BY allocation.receivableId, allocation.createdAt, allocation.id
      `).all(params);
    },

    listAdjustments(scope = {}, options = {}) {
      const params = {};
      const where = scopedWhere(scope, 'adjustment', params, options.branchId);
      if (options.receivableId) {
        where.push('adjustment.receivableId = @receivableId');
        params.receivableId = requiredText(options.receivableId, 'receivableId');
      }
      if (appendReceivableIdScope(where, params, 'adjustment', options.receivableIds)) return [];
      return db.prepare(`
        SELECT adjustment.*
        FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} adjustment
        WHERE ${where.join(' AND ')}
        ORDER BY adjustment.receivableId, adjustment.createdAt, adjustment.id
      `).all(params);
    },

    listReceivableAuditEvents(scope = {}, options = {}) {
      const params = {};
      const where = scopedWhere(scope, 'event', params, options.branchId);
      where.push("event.aggregateType = 'receivable'");
      if (options.receivableId) {
        where.push('event.aggregateId = @receivableId');
        params.receivableId = requiredText(options.receivableId, 'receivableId');
      }
      if (Array.isArray(options.receivableIds)) {
        if (options.receivableIds.length === 0) return [];
        const placeholders = options.receivableIds.map((id, index) => {
          const key = `auditReceivableScopeId${index}`;
          params[key] = requiredText(id, 'receivableId');
          return `@${key}`;
        });
        where.push(`event.aggregateId IN (${placeholders.join(', ')})`);
      }
      return db.prepare(`
        SELECT event.id, event.aggregateId, event.eventType, event.occurredAt,
          event.previousValueJson, event.newValueJson, event.correlationId
        FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} event
        WHERE ${where.join(' AND ')}
        ORDER BY event.aggregateId, event.occurredAt, event.id
      `).all(params);
    },

    listPayments(scope = {}, options = {}) {
      const params = {};
      const where = scopedWhere(scope, 'payment', params, options.branchId);
      if (options.receiptsOnly === true) where.push("payment.paymentKind = 'receipt'");
      if (options.after) {
        where.push(`(
          payment.receivedAt > @afterReceivedAt
          OR (payment.receivedAt = @afterReceivedAt AND payment.id > @afterId)
        )`);
        params.afterReceivedAt = requiredText(options.after.receivedAt, 'afterReceivedAt');
        params.afterId = requiredText(options.after.id, 'afterId');
      }
      let limitClause = '';
      if (options.limit !== undefined) {
        if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
          fail('INVALID_READ_BATCH_LIMIT', 'Read batch limit must be a positive safe integer.', 'limit');
        }
        params.limit = options.limit;
        limitClause = 'LIMIT @limit';
      }
      return db.prepare(`
        SELECT payment.*
        FROM ${CANONICAL_PAYMENTS_TABLE} payment
        WHERE ${where.join(' AND ')}
        ORDER BY payment.receivedAt, payment.id
        ${limitClause}
      `).all(params);
    },

    listPaymentAllocations(scope = {}, options = {}) {
      const params = {};
      const normalized = normalizeBranchScope(scope);
      const where = ['allocation.companyId = @companyId'];
      params.companyId = normalized.companyId;
      if (options.branchId) {
        where.push('allocation.paymentBranchId = @requestedBranchId');
        params.requestedBranchId = options.branchId;
      } else if (!normalized.companyWideBranchAccess) {
        const placeholders = normalized.branchIds.map((branchId, index) => {
          const key = `paymentAllocationBranchId${index}`;
          params[key] = branchId;
          return `@${key}`;
        });
        where.push(`allocation.paymentBranchId IN (${placeholders.join(', ')})`);
      }
      if (appendPaymentIdScope(where, params, 'allocation', options.paymentIds)) return [];
      if (options.after) {
        where.push(`(
          allocation.createdAt > @afterCreatedAt
          OR (allocation.createdAt = @afterCreatedAt AND allocation.id > @afterId)
        )`);
        params.afterCreatedAt = requiredText(options.after.createdAt, 'afterCreatedAt');
        params.afterId = requiredText(options.after.id, 'afterId');
      }
      let limitClause = '';
      if (options.limit !== undefined) {
        if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
          fail('INVALID_READ_BATCH_LIMIT', 'Read batch limit must be a positive safe integer.', 'limit');
        }
        params.limit = options.limit;
        limitClause = 'LIMIT @limit';
      }
      return db.prepare(`
        SELECT allocation.*
        FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
        WHERE ${where.join(' AND ')}
        ORDER BY allocation.createdAt, allocation.id
        ${limitClause}
      `).all(params);
    },

    listPaymentCompensations(scope = {}, options = {}) {
      const params = {};
      const where = scopedWhere(scope, 'event', params, options.branchId);
      if (!Array.isArray(options.receiptIds) || options.receiptIds.length === 0) return [];
      const placeholders = options.receiptIds.map((id, index) => {
        const key = `receiptScopeId${index}`;
        params[key] = requiredText(id, 'paymentId');
        return `@${key}`;
      });
      const receiptScope = placeholders.join(', ');
      where.push(`(
        event.reversalOfPaymentId IN (${receiptScope})
        OR (
          event.paymentKind = 'reversal'
          AND originalRefund.paymentKind = 'refund'
          AND originalRefund.reversalOfPaymentId IN (${receiptScope})
        )
      )`);
      if (options.after) {
        where.push(`(
          event.receivedAt > @afterReceivedAt
          OR (event.receivedAt = @afterReceivedAt AND event.id > @afterId)
        )`);
        params.afterReceivedAt = requiredText(options.after.receivedAt, 'afterReceivedAt');
        params.afterId = requiredText(options.after.id, 'afterId');
      }
      let limitClause = '';
      if (options.limit !== undefined) {
        if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
          fail('INVALID_READ_BATCH_LIMIT', 'Read batch limit must be a positive safe integer.', 'limit');
        }
        params.limit = options.limit;
        limitClause = 'LIMIT @limit';
      }
      return db.prepare(`
        SELECT event.id, event.receivedAt, event.workflowStatus,
          CASE
            WHEN event.reversalOfPaymentId IN (${receiptScope}) THEN event.reversalOfPaymentId
            ELSE originalRefund.reversalOfPaymentId
          END AS receiptId,
          CASE
            WHEN event.reversalOfPaymentId IN (${receiptScope}) THEN event.refundAmountMinor
            ELSE -event.refundAmountMinor
          END AS refundDeltaMinor
        FROM ${CANONICAL_PAYMENTS_TABLE} event
        LEFT JOIN ${CANONICAL_PAYMENTS_TABLE} originalRefund
          ON originalRefund.companyId = event.companyId
         AND originalRefund.id = event.reversalOfPaymentId
        WHERE ${where.join(' AND ')}
        ORDER BY event.receivedAt, event.id
        ${limitClause}
      `).all(params);
    },
  });

  function readSnapshot(callback) {
    if (typeof callback !== 'function') fail('READ_CALLBACK_REQUIRED', 'A read snapshot callback is required.');
    const transaction = db.transaction(() => callback(queries));
    return transaction.deferred();
  }

  return Object.freeze({ readSnapshot });
}

module.exports = {
  CanonicalReceivablesReadRepositoryError,
  createCanonicalReceivablesReadRepository,
  normalizeBranchScope,
};
