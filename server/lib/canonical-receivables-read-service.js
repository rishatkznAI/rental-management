const crypto = require('crypto');
const {
  AGING_CALCULATION_VERSION,
  createCanonicalAgingAccumulator,
  resolveAsOfDate,
  validateDateOnly,
  validateTimezone,
} = require('./canonical-receivables-aging');
const {
  createScopedUnappliedPaymentsAccumulator,
  matchesReceivableFilters,
  projectScopedReceivables,
} = require('./canonical-receivables-read-model');

const LIST_FILTERS = new Set([
  'branchId', 'clientId', 'contractId', 'rentalId', 'sourceSystem',
  'sourceDocumentType', 'sourceDocumentId', 'sourceLineId', 'status',
  'balanceStatus', 'agingStatus', 'currency', 'dueDateFrom', 'dueDateTo',
  'issuedFrom', 'issuedTo', 'asOfDate', 'cursor', 'limit',
]);
const AGGREGATE_FILTERS = new Set([
  'branchId', 'clientId', 'contractId', 'rentalId', 'sourceSystem',
  'sourceDocumentType', 'sourceDocumentId', 'sourceLineId', 'status',
  'balanceStatus', 'agingStatus', 'currency', 'dueDateFrom', 'dueDateTo',
  'issuedFrom', 'issuedTo', 'asOfDate',
]);
const DETAIL_FILTERS = new Set(['asOfDate', 'currency']);
const STATUS_VALUES = new Set(['draft', 'posted', 'disputed', 'cancelled', 'written_off']);
const BALANCE_STATUS_VALUES = new Set(['open', 'partially_paid', 'paid', 'not_applicable']);
const AGING_STATUS_VALUES = new Set(['current', 'overdue', 'ambiguous', 'disputed', 'otherExcluded', 'settled']);
const CURSOR_SECRET_MIN_BYTES = 32;
const INSECURE_CURSOR_SECRETS = new Set([
  'change-me',
  'changeme',
  'canonical-receivables-cursor-secret',
  'cursor-secret',
  'default',
  'replace-me',
  'replace-this-secret',
  'secret',
  'test-secret',
]);

class CanonicalReceivablesReadServiceError extends Error {
  constructor(code, message, { field, status = 400 } = {}) {
    super(message);
    this.name = 'CanonicalReceivablesReadServiceError';
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

function fail(code, message, options) {
  throw new CanonicalReceivablesReadServiceError(code, message, options);
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('RECEIVABLES_SCOPE_DENIED', `${field} is required in trusted scope.`, { field, status: 403 });
  }
  return value.trim();
}

function normalizeCapabilities(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.map(item => String(item || '').trim()).filter(Boolean));
  return new Set();
}

function normalizeTrustedScope(input = {}) {
  if (input.authenticated !== true) {
    fail('RECEIVABLES_SCOPE_DENIED', 'Authenticated trusted scope is required.', { status: 403 });
  }
  const principalId = requiredText(input.principalId, 'principalId');
  const companyId = requiredText(input.companyId, 'companyId');
  if (!normalizeCapabilities(input.capabilities).has('receivables.read')) {
    fail('RECEIVABLES_READ_FORBIDDEN', 'The receivables.read capability is required.', { status: 403 });
  }
  if (input.companyWideBranchAccess === true) {
    return Object.freeze({
      authenticated: true,
      principalId,
      companyId,
      companyWideBranchAccess: true,
      branchIds: null,
      receivablesTimezone: input.receivablesTimezone || null,
    });
  }
  const branchIds = Array.isArray(input.allowedBranchIds)
    ? [...new Set(input.allowedBranchIds.map(value => String(value || '').trim()).filter(Boolean))].sort()
    : [];
  if (branchIds.length === 0) {
    fail('RECEIVABLES_SCOPE_DENIED', 'Trusted allowed branch IDs are required.', { status: 403 });
  }
  return Object.freeze({
    authenticated: true,
    principalId,
    companyId,
    companyWideBranchAccess: false,
    branchIds,
    receivablesTimezone: input.receivablesTimezone || null,
  });
}

function assertKnownFilters(query, allowed) {
  const unknown = Object.keys(query || {}).filter(key => !allowed.has(key));
  if (unknown.length > 0) {
    fail('UNKNOWN_FILTER', `Unknown canonical receivables filter: ${unknown[0]}.`, { field: unknown[0] });
  }
}

function normalizeCurrency(value) {
  const currency = String(value || 'RUB').trim().toUpperCase();
  if (currency !== 'RUB') {
    fail('UNSUPPORTED_CURRENCY', 'The canonical receivables read API supports RUB only.', {
      field: 'currency',
      status: 422,
    });
  }
  return currency;
}

function normalizeDateFilter(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    return validateDateOnly(String(value), field);
  } catch (error) {
    fail(error.code || 'INVALID_DATE', error.message, { field, status: 400 });
  }
}

function normalizeFilters(query = {}) {
  const filters = {};
  for (const field of [
    'branchId', 'clientId', 'contractId', 'rentalId', 'sourceSystem',
    'sourceDocumentType', 'sourceDocumentId', 'sourceLineId', 'status',
    'balanceStatus', 'agingStatus',
  ]) {
    if (query[field] !== undefined && query[field] !== null && String(query[field]).trim()) {
      filters[field] = String(query[field]).trim();
    }
  }
  filters.currency = normalizeCurrency(query.currency);
  for (const field of ['dueDateFrom', 'dueDateTo', 'issuedFrom', 'issuedTo']) {
    const normalized = normalizeDateFilter(query[field], field);
    if (normalized) filters[field] = normalized;
  }
  if (filters.dueDateFrom && filters.dueDateTo && filters.dueDateFrom > filters.dueDateTo) {
    fail('INVALID_DATE_RANGE', 'dueDateFrom cannot be after dueDateTo.', { field: 'dueDateFrom' });
  }
  if (filters.issuedFrom && filters.issuedTo && filters.issuedFrom > filters.issuedTo) {
    fail('INVALID_DATE_RANGE', 'issuedFrom cannot be after issuedTo.', { field: 'issuedFrom' });
  }
  if (filters.status && !STATUS_VALUES.has(filters.status)) {
    fail('INVALID_STORED_STATUS', 'status is not an approved stored receivable state.', { field: 'status' });
  }
  if (filters.balanceStatus && !BALANCE_STATUS_VALUES.has(filters.balanceStatus)) {
    fail('INVALID_BALANCE_STATUS', 'balanceStatus is not approved.', { field: 'balanceStatus' });
  }
  if (filters.agingStatus && !AGING_STATUS_VALUES.has(filters.agingStatus)) {
    fail('INVALID_AGING_STATUS', 'agingStatus is not approved.', { field: 'agingStatus' });
  }
  return filters;
}

function assertAuthorizedBranch(scope, branchId) {
  if (!branchId) return;
  if (!scope.companyWideBranchAccess && !scope.branchIds.includes(branchId)) {
    fail('BRANCH_SCOPE_FORBIDDEN', 'The requested branch is outside the trusted scope.', {
      field: 'branchId',
      status: 403,
    });
  }
}

function makeScopeMetadata(scope, branchId, timezone, asOfDate) {
  return Object.freeze({
    companyId: scope.companyId,
    branchScope: branchId
      ? 'selected'
      : scope.companyWideBranchAccess ? 'all_authorized' : 'allowed_branches',
    branchId: branchId || null,
    branchIds: branchId ? [branchId] : scope.branchIds,
    companyWideBranchAccess: scope.companyWideBranchAccess,
    timezone,
    asOfDate,
    currency: 'RUB',
  });
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return 50;
  if (!/^\d+$/.test(String(value))) {
    fail('INVALID_LIMIT', 'limit must be an integer between 1 and 200.', { field: 'limit' });
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    fail('INVALID_LIMIT', 'limit must be an integer between 1 and 200.', { field: 'limit' });
  }
  return limit;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createCursorCodec(secret) {
  const key = typeof secret === 'string' ? secret : '';
  const normalizedKey = key.trim();
  if (
    Buffer.byteLength(normalizedKey, 'utf8') < CURSOR_SECRET_MIN_BYTES
    || new Set(Buffer.from(normalizedKey, 'utf8')).size < 8
    || INSECURE_CURSOR_SECRETS.has(normalizedKey.toLowerCase())
  ) {
    fail(
      'CURSOR_CONFIGURATION_INVALID',
      `Canonical cursor signing requires a non-default secret of at least ${CURSOR_SECRET_MIN_BYTES} bytes.`,
      { status: 500 },
    );
  }
  function fingerprint(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('base64url');
  }
  function sign(payload) {
    return crypto.createHmac('sha256', key).update(payload).digest('base64url');
  }
  return Object.freeze({
    encode(position, context) {
      const payload = Buffer.from(JSON.stringify({
        v: 1,
        createdAt: position.createdAt,
        id: position.id,
        context: fingerprint(context),
      })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    decode(cursor, context) {
      if (typeof cursor !== 'string' || !cursor.trim() || !cursor.includes('.')) {
        fail('INVALID_CURSOR', 'cursor is malformed or has been tampered with.', { field: 'cursor' });
      }
      const [payload, signature, ...rest] = cursor.split('.');
      if (!payload || !signature || rest.length > 0) {
        fail('INVALID_CURSOR', 'cursor is malformed or has been tampered with.', { field: 'cursor' });
      }
      const expected = sign(payload);
      const left = Buffer.from(signature);
      const right = Buffer.from(expected);
      if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
        fail('INVALID_CURSOR', 'cursor is malformed or has been tampered with.', { field: 'cursor' });
      }
      let decoded;
      try {
        decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        fail('INVALID_CURSOR', 'cursor is malformed or has been tampered with.', { field: 'cursor' });
      }
      if (
        decoded?.v !== 1
        || typeof decoded.createdAt !== 'string'
        || typeof decoded.id !== 'string'
        || decoded.context !== fingerprint(context)
      ) {
        fail('INVALID_CURSOR', 'cursor is malformed or does not match this request.', { field: 'cursor' });
      }
      return { createdAt: decoded.createdAt, id: decoded.id };
    },
  });
}

function safeAdd(left, right, field) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    fail('MINOR_UNIT_OVERFLOW', `${field} exceeds the safe integer range.`, { field, status: 500 });
  }
  return value;
}

function createCanonicalReceivablesReadService({ repository, cursorSecret, now = () => new Date() } = {}) {
  if (!repository || typeof repository.readSnapshot !== 'function') {
    fail('READ_REPOSITORY_REQUIRED', 'The canonical read repository is required.', { status: 500 });
  }
  const cursorCodec = createCursorCodec(cursorSecret);

  function prepare(query, scopeInput, allowedFilters) {
    assertKnownFilters(query, allowedFilters);
    const scope = normalizeTrustedScope(scopeInput);
    const filters = normalizeFilters(query);
    assertAuthorizedBranch(scope, filters.branchId);
    return { scope, filters, requestedAsOfDate: query.asOfDate };
  }

  function resolvePreparedInSnapshot(reader, prepared) {
    const { scope, filters } = prepared;
    const company = reader.getCompany(scope);
    const knownBranchIds = new Set(reader.listBranches(scope));
    if (!company && !scope.companyWideBranchAccess) {
      fail('RECEIVABLES_SCOPE_DENIED', 'Trusted branch scope cannot be resolved.', { status: 403 });
    }
    if (filters.branchId && !knownBranchIds.has(filters.branchId)) {
      fail('BRANCH_SCOPE_FORBIDDEN', 'The requested branch is outside the trusted scope.', {
        field: 'branchId',
        status: 403,
      });
    }
    if (
      company
      && !scope.companyWideBranchAccess
      && scope.branchIds.some(branchId => !knownBranchIds.has(branchId))
    ) {
      fail('RECEIVABLES_SCOPE_DENIED', 'Trusted branch scope contains an unknown branch.', { status: 403 });
    }
    const timezoneCandidate = company?.receivablesTimezone || scope.receivablesTimezone;
    let timezone;
    try {
      timezone = validateTimezone(timezoneCandidate);
    } catch (error) {
      fail(error.code || 'INVALID_COMPANY_TIMEZONE', error.message, { field: 'timezone', status: 500 });
    }
    let asOfDate;
    try {
      asOfDate = resolveAsOfDate({ asOfDate: prepared.requestedAsOfDate, timezone, now: now() });
    } catch (error) {
      fail(error.code || 'INVALID_DATE', error.message, { field: error.field || 'asOfDate', status: 400 });
    }
    return { prepared: { ...prepared, timezone, asOfDate }, company };
  }

  function loadSnapshot(prepared, options = {}) {
    const { scope, filters } = prepared;
    return repository.readSnapshot(reader => {
      const resolved = resolvePreparedInSnapshot(reader, prepared);
      return {
        prepared: resolved.prepared,
        snapshot: {
          company: resolved.company,
          receivables: reader.listReceivables(scope, { branchId: filters.branchId, id: options.id }),
          allocations: reader.listAllocations(scope, { branchId: filters.branchId, receivableId: options.id }),
          adjustments: reader.listAdjustments(scope, { branchId: filters.branchId, receivableId: options.id }),
          auditEvents: reader.listReceivableAuditEvents(scope, { branchId: filters.branchId, receivableId: options.id }),
        },
      };
    });
  }

  function forEachProjectedBatch(reader, prepared, callback) {
    const batchLimit = 200;
    let position = null;
    while (true) {
      const receivables = reader.listReceivables(prepared.scope, {
        branchId: prepared.filters.branchId,
        after: position,
        limit: batchLimit,
      });
      if (receivables.length === 0) break;
      const receivableIds = receivables.map(row => row.id);
      callback(projected(prepared, {
        receivables,
        allocations: reader.listAllocations(prepared.scope, {
          branchId: prepared.filters.branchId,
          receivableIds,
        }),
        adjustments: reader.listAdjustments(prepared.scope, {
          branchId: prepared.filters.branchId,
          receivableIds,
        }),
        auditEvents: reader.listReceivableAuditEvents(prepared.scope, {
          branchId: prepared.filters.branchId,
          receivableIds,
        }),
      }));
      const last = receivables[receivables.length - 1];
      position = { createdAt: last.createdAt, id: last.id };
      if (receivables.length < batchLimit) break;
    }
  }

  function calculateUnappliedPaymentMinor(reader, prepared) {
    const batchLimit = 200;
    let position = null;
    let total = 0;
    while (true) {
      const receipts = reader.listPayments(prepared.scope, {
        branchId: prepared.filters.branchId,
        after: position,
        limit: batchLimit,
        receiptsOnly: true,
      });
      if (receipts.length === 0) break;
      const receiptIds = receipts.map(row => row.id);
      const accumulator = createScopedUnappliedPaymentsAccumulator({
        asOfDate: prepared.asOfDate,
        timezone: prepared.timezone,
        clientId: prepared.filters.clientId,
        currency: prepared.filters.currency,
      });
      accumulator.addPayments(receipts);

      let allocationPosition = null;
      while (true) {
        const allocations = reader.listPaymentAllocations(prepared.scope, {
          branchId: prepared.filters.branchId,
          paymentIds: receiptIds,
          after: allocationPosition,
          limit: batchLimit,
        });
        if (allocations.length === 0) break;
        accumulator.addAllocations(allocations);
        const last = allocations[allocations.length - 1];
        allocationPosition = { createdAt: last.createdAt, id: last.id };
        if (allocations.length < batchLimit) break;
      }

      let compensationPosition = null;
      while (true) {
        const compensations = reader.listPaymentCompensations(prepared.scope, {
          branchId: prepared.filters.branchId,
          receiptIds,
          after: compensationPosition,
          limit: batchLimit,
        });
        if (compensations.length === 0) break;
        accumulator.addPaymentEffects(compensations);
        const last = compensations[compensations.length - 1];
        compensationPosition = { receivedAt: last.receivedAt, id: last.id };
        if (compensations.length < batchLimit) break;
      }

      total = safeAdd(total, accumulator.finish(), 'unappliedPaymentMinor');
      const last = receipts[receipts.length - 1];
      position = { receivedAt: last.receivedAt, id: last.id };
      if (receipts.length < batchLimit) break;
    }
    return total;
  }

  function projected(prepared, snapshot) {
    const views = projectScopedReceivables(snapshot, prepared);
    const ids = new Set();
    const sources = new Set();
    for (const view of views) {
      if (view.companyId !== prepared.scope.companyId || view.currency !== 'RUB') {
        fail(
          'CANONICAL_SCOPE_CURRENCY_INTEGRITY_ERROR',
          'Canonical receivable scope or currency integrity failed.',
          { status: 500 },
        );
      }
      const sourceIdentity = stableJson([
        view.companyId,
        view.sourceSystem,
        view.sourceDocumentType,
        view.sourceDocumentId,
        view.normalizedSourceLineId || view.sourceLineId || '__document_total__',
      ]);
      if (ids.has(view.id) || sources.has(sourceIdentity)) {
        fail(
          'CANONICAL_IDENTITY_INTEGRITY_ERROR',
          'Duplicate canonical receivable identity detected.',
          { status: 500 },
        );
      }
      ids.add(view.id);
      sources.add(sourceIdentity);
    }
    return views.filter(view => matchesReceivableFilters(view, prepared.filters, prepared.timezone));
  }

  function list(query = {}, scopeInput = {}) {
    const initial = prepare(query, scopeInput, LIST_FILTERS);
    const limit = normalizeLimit(query.limit);
    return repository.readSnapshot(reader => {
      const { prepared } = resolvePreparedInSnapshot(reader, initial);
      const scopeMetadata = makeScopeMetadata(
        prepared.scope,
        prepared.filters.branchId,
        prepared.timezone,
        prepared.asOfDate,
      );
      const cursorContext = {
        scope: scopeMetadata,
        principalId: prepared.scope.principalId,
        capability: 'receivables.read',
        ordering: ['createdAt', 'id'],
        filters: prepared.filters,
      };
      let position = query.cursor ? cursorCodec.decode(query.cursor, cursorContext) : null;
      const matches = [];
      const batchLimit = 201;
      while (matches.length <= limit) {
        const receivables = reader.listReceivables(prepared.scope, {
          branchId: prepared.filters.branchId,
          after: position,
          limit: batchLimit,
        });
        if (receivables.length === 0) break;
        const receivableIds = receivables.map(row => row.id);
        const batch = {
          receivables,
          allocations: reader.listAllocations(prepared.scope, {
            branchId: prepared.filters.branchId,
            receivableIds,
          }),
          adjustments: reader.listAdjustments(prepared.scope, {
            branchId: prepared.filters.branchId,
            receivableIds,
          }),
          auditEvents: reader.listReceivableAuditEvents(prepared.scope, {
            branchId: prepared.filters.branchId,
            receivableIds,
          }),
        };
        for (const view of projected(prepared, batch)) {
          matches.push(view);
          if (matches.length > limit) break;
        }
        const last = receivables[receivables.length - 1];
        position = { createdAt: last.createdAt, id: last.id };
        if (receivables.length < batchLimit) break;
      }
      const hasMore = matches.length > limit;
      const items = matches.slice(0, limit);
      return {
        items,
        nextCursor: hasMore ? cursorCodec.encode(items[items.length - 1], cursorContext) : null,
        hasMore,
        scope: scopeMetadata,
      };
    });
  }

  function detail(id, query = {}, scopeInput = {}) {
    assertKnownFilters(query, DETAIL_FILTERS);
    const loaded = loadSnapshot(
      prepare(query, scopeInput, DETAIL_FILTERS),
      { id: requiredText(id, 'id') },
    );
    const { prepared, snapshot } = loaded;
    const views = projectScopedReceivables(snapshot, prepared);
    const view = views[0];
    if (!view || view.currency !== prepared.filters.currency) return null;
    return {
      ...view,
      canonicalLinks: {
        paymentAllocationIds: snapshot.allocations.map(row => row.id),
        receivableAdjustmentIds: snapshot.adjustments.map(row => row.id),
      },
    };
  }

  function aging(query = {}, scopeInput = {}) {
    const initial = prepare(query, scopeInput, AGGREGATE_FILTERS);
    return repository.readSnapshot(reader => {
      const { prepared } = resolvePreparedInSnapshot(reader, initial);
      const scopeMetadata = makeScopeMetadata(
        prepared.scope,
        prepared.filters.branchId,
        prepared.timezone,
        prepared.asOfDate,
      );
      const accumulator = createCanonicalAgingAccumulator({
        asOfDate: prepared.asOfDate,
        timezone: prepared.timezone,
        currency: prepared.filters.currency,
        companyId: prepared.scope.companyId,
        branchScope: scopeMetadata.branchScope,
      });
      forEachProjectedBatch(reader, prepared, views => accumulator.addMany(views));
      return {
        ...accumulator.finish(),
        scope: scopeMetadata,
        request: { filters: prepared.filters },
      };
    });
  }

  function summary(query = {}, scopeInput = {}) {
    const initial = prepare(query, scopeInput, AGGREGATE_FILTERS);
    return repository.readSnapshot(reader => {
      const { prepared } = resolvePreparedInSnapshot(reader, initial);
      const scopeMetadata = makeScopeMetadata(
        prepared.scope,
        prepared.filters.branchId,
        prepared.timezone,
        prepared.asOfDate,
      );
      const agingAccumulator = createCanonicalAgingAccumulator({
        asOfDate: prepared.asOfDate,
        timezone: prepared.timezone,
        currency: prepared.filters.currency,
        companyId: prepared.scope.companyId,
        branchScope: scopeMetadata.branchScope,
      });
      const totals = {
        originalAmountMinor: 0,
        confirmedDebitAdjustmentsMinor: 0,
        confirmedCreditAdjustmentsMinor: 0,
        confirmedAllocatedMinor: 0,
        confirmedWriteOffMinor: 0,
      };
      let receivableCount = 0;
      forEachProjectedBatch(reader, prepared, views => {
        agingAccumulator.addMany(views);
        receivableCount += views.length;
        for (const view of views) {
          for (const field of Object.keys(totals)) {
            totals[field] = safeAdd(totals[field], view[field], field);
          }
        }
      });
      const agingResult = agingAccumulator.finish();
      return {
        asOfDate: prepared.asOfDate,
        timezone: prepared.timezone,
        currency: prepared.filters.currency,
        companyId: prepared.scope.companyId,
        branchScope: scopeMetadata.branchScope,
        calculationVersion: AGING_CALCULATION_VERSION,
        receivableCount,
        ...totals,
        totalOutstandingMinor: agingResult.totalOutstandingMinor,
        eligibleOutstandingMinor: agingResult.eligibleOutstandingMinor,
        currentMinor: agingResult.currentMinor,
        overdueMinor: agingResult.overdueMinor,
        unappliedPaymentMinor: calculateUnappliedPaymentMinor(reader, prepared),
        ambiguousAmountMinor: agingResult.ambiguousAmountMinor,
        ambiguousCount: agingResult.counts.ambiguous,
        disputedAmountMinor: agingResult.disputedAmountMinor,
        disputedCount: agingResult.counts.disputed,
        otherExcludedAmountMinor: agingResult.otherExcludedAmountMinor,
        otherExcludedCount: agingResult.counts.otherExcluded,
        integrityErrorCount: agingResult.integrityErrorCount,
        reconciled: agingResult.reconciled,
        scope: scopeMetadata,
        request: { filters: prepared.filters },
      };
    });
  }

  return Object.freeze({ aging, detail, list, summary });
}

module.exports = {
  AGGREGATE_FILTERS,
  CanonicalReceivablesReadServiceError,
  DETAIL_FILTERS,
  LIST_FILTERS,
  createCanonicalReceivablesReadService,
  createCursorCodec,
  normalizeTrustedScope,
};
