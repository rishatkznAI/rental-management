const {
  ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
  CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,
} = require('./canonical-actual-posting-schema');
const {
  prepareSqliteReadonlyStatement,
} = require('./sqlite-readonly-statement');
const {
  CANONICAL_RECEIVABLES_TABLE,
} = require('./canonical-receivables-schema');
const {
  ERROR_CODES,
  CanonicalActualPostingError,
  assertIdentifier,
} = require('./canonical-actual-posting-domain');
const {
  createCanonicalActualPostingRuntimeService,
} = require('./canonical-actual-posting-runtime-service');
const {
  assertBranchScope,
  assertCapability,
  assertCompanyScope,
  buildScopedPredicate,
} = require('./platform-authorization');

const PRODUCT_RUNTIME_DISABLED_MESSAGE = 'Функция пока не включена в этом окружении.';
const PRODUCT_CONFLICT_POSTING_OUTCOMES = new Set([
  'CONFLICT_COMPLETED',
  'CONFLICT_RECOVERY_REQUIRED',
  'CONFLICT_RESULT_MISMATCH',
  'DENIAL_PERSISTED',
  'DENIAL_RECLASSIFIED',
  'EXACT_CONFLICT_REPLAY',
  'IDEMPOTENCY_CONTENT_CONFLICT',
  'PRIMARY_RESULT_INTEGRITY_BLOCKED',
  ERROR_CODES.POSTING_ASSERTION_MISMATCH,
]);
const PRODUCT_NOT_READY_POSTING_OUTCOMES = new Set([
  'DENIAL_NO_LONGER_CURRENT',
]);

class CanonicalActualPostingProductError extends Error {
  constructor(status, productStatus, publicMessage, internalCode = productStatus) {
    super(publicMessage);
    this.name = 'CanonicalActualPostingProductError';
    this.status = status;
    this.productStatus = productStatus;
    this.publicMessage = publicMessage;
    this.internalCode = internalCode;
  }
}

function productError(status, productStatus, publicMessage, internalCode) {
  return new CanonicalActualPostingProductError(
    status,
    productStatus,
    publicMessage,
    internalCode,
  );
}

function normalizePostingFailure(error) {
  const code = error instanceof CanonicalActualPostingError
    ? error.code
    : ERROR_CODES.POSTING_DATABASE_FAILED;
  if (code === ERROR_CODES.PR9B_DISABLED) {
    return productError(409, 'runtime_disabled', PRODUCT_RUNTIME_DISABLED_MESSAGE, code);
  }
  if (code === ERROR_CODES.POSTING_EVENT_NOT_FOUND) {
    return productError(404, 'not_found', 'Подготовленная операция не найдена.', code);
  }
  if (
    PRODUCT_CONFLICT_POSTING_OUTCOMES.has(String(code))
    || /CONFLICT|MISMATCH|INTEGRITY|DRIFT|RECOVERY|CONCURRENT/.test(String(code))
  ) {
    return productError(
      409,
      'conflict',
      'Начисление не создано. Обнаружен конфликт данных.',
      code,
    );
  }
  if (error instanceof CanonicalActualPostingError) {
    return productError(
      409,
      'not_ready',
      'Операция пока не готова к созданию фактического начисления.',
      code,
    );
  }
  return productError(
    500,
    'failed',
    'Не удалось создать фактическое начисление.',
    code,
  );
}

function clientLabel(clients, clientId) {
  const match = clients.find(client => String(client?.id || '').trim() === clientId);
  return String(match?.name || match?.companyName || match?.shortName || clientId).trim();
}

function previewItem(row, clients, runtimeEnabled) {
  const alreadyCreated = Boolean(row.operationId && row.canonicalReceivableId);
  const readiness = alreadyCreated
    ? 'already_created'
    : runtimeEnabled
      ? 'ready'
      : 'runtime_disabled';
  return Object.freeze({
    eventId: row.eventId,
    companyId: row.companyId,
    branchId: row.branchId,
    branch: row.branchDisplayName || row.branchId,
    clientId: row.clientId,
    client: clientLabel(clients, row.clientId),
    contractId: row.contractId || null,
    rentalId: row.rentalId,
    sourceDocumentId: row.sourceDocumentId,
    periodId: row.periodId,
    periodStartDate: row.periodStartDate,
    periodEndDateExclusive: row.periodEndDateExclusive,
    amount: Number(row.originalAmountMinor),
    currency: row.currency,
    basis: row.amountBasis,
    dueDate: row.contractualDueDate || null,
    readiness,
    canPost: runtimeEnabled && !alreadyCreated,
    disabledReason: alreadyCreated
      ? 'Начисление уже было создано ранее.'
      : runtimeEnabled
        ? null
        : PRODUCT_RUNTIME_DISABLED_MESSAGE,
    replayed: alreadyCreated,
    receivableId: row.canonicalReceivableId || null,
    operationId: row.operationId || null,
    preparedAt: row.preparedAt,
  });
}

function createCanonicalActualPostingProductService({
  db,
  runtimeContract,
  runtimeEnabled = false,
  readClients = () => [],
} = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('Canonical actual posting product service requires a database.');
  }
  const runtimeService = createCanonicalActualPostingRuntimeService({ db, runtimeContract });

  const previewSelect = `
    SELECT
      event.id AS eventId,
      event.companyId,
      event.branchId,
      branch.displayName AS branchDisplayName,
      event.clientId,
      event.contractId,
      event.rentalId,
      event.rootSourceDocumentLineageId AS sourceDocumentId,
      event.periodId,
      event.sliceStartDate AS periodStartDate,
      event.sliceEndDateExclusive AS periodEndDateExclusive,
      event.originalAmountMinor,
      event.currency,
      event.amountBasis,
      event.contractualDueDate,
      event.createdAt AS preparedAt,
      operation.id AS operationId,
      operation.canonicalReceivableId
    FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE} AS event
    INNER JOIN canonical_branches AS branch
      ON branch.companyId = event.companyId AND branch.id = event.branchId
    LEFT JOIN ${CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE} AS operation
      ON operation.eventId = event.id
    LEFT JOIN ${CANONICAL_RECEIVABLES_TABLE} AS receivable
      ON receivable.id = operation.canonicalReceivableId
      AND receivable.companyId = event.companyId
      AND receivable.branchId = event.branchId
  `;

  function assertEnabled() {
    if (!runtimeEnabled) {
      throw productError(409, 'runtime_disabled', PRODUCT_RUNTIME_DISABLED_MESSAGE);
    }
  }

  function prepareReadonly(sql) {
    return prepareSqliteReadonlyStatement(
      db,
      sql,
      'canonical_actual_posting_product_read',
    );
  }

  function readEventScope(eventId) {
    assertIdentifier(eventId, 'eventId');
    const row = prepareReadonly(`
      SELECT companyId, branchId
      FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
      WHERE id = ?
    `).get(eventId);
    return row ? Object.freeze({ companyId: row.companyId, branchId: row.branchId }) : null;
  }

  function listEligibleEvents(scope) {
    assertCapability(scope, 'receivables.read');
    const predicate = buildScopedPredicate(scope, { alias: 'event' });
    const rows = prepareReadonly(`
      ${previewSelect}
      WHERE ${predicate.where}
      ORDER BY event.createdAt DESC, event.id ASC
      LIMIT 50
    `).all(predicate.params);
    const clientRows = readClients();
    const clients = Array.isArray(clientRows) ? clientRows : [];
    return Object.freeze({
      ok: true,
      runtime: Object.freeze({
        enabled: runtimeEnabled,
        message: runtimeEnabled ? null : PRODUCT_RUNTIME_DISABLED_MESSAGE,
      }),
      items: Object.freeze(rows.map(row => previewItem(row, clients, runtimeEnabled))),
    });
  }

  function disabledPreview() {
    return Object.freeze({
      ok: true,
      runtime: Object.freeze({ enabled: false, message: PRODUCT_RUNTIME_DISABLED_MESSAGE }),
      items: Object.freeze([]),
    });
  }

  function postEligibleEvent({ eventId, scope } = {}) {
    assertEnabled();
    const eventScope = readEventScope(eventId);
    if (!eventScope) {
      throw productError(404, 'not_found', 'Подготовленная операция не найдена.');
    }
    assertCapability(scope, 'receivables.read');
    assertCompanyScope(scope, eventScope.companyId);
    assertBranchScope(scope, eventScope.branchId);
    try {
      const result = runtimeService.postEligibleEvent({
        eventId,
        companyId: eventScope.companyId,
        branchId: eventScope.branchId,
      });
      const evidence = result.posting?.evidence || {};
      const event = prepareReadonly(`
        SELECT originalAmountMinor, currency
        FROM ${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}
        WHERE id = ?
      `).get(eventId);
      if (result.posting?.outcome === 'POSTED') {
        return Object.freeze({
          ok: true,
          status: 'created',
          replayed: false,
          receivableId: evidence.canonicalReceivableId,
          operationId: evidence.operationId,
          amount: Number(event.originalAmountMinor),
          currency: event.currency,
        });
      }
      if (result.posting?.outcome === 'EXACT_COMMITTED_RESULT') {
        return Object.freeze({
          ok: true,
          status: 'already_created',
          replayed: true,
          receivableId: evidence.canonicalReceivableId,
          operationId: evidence.operationId,
          amount: Number(event.originalAmountMinor),
          currency: event.currency,
        });
      }
      const outcome = String(result.posting?.outcome || '');
      if (
        PRODUCT_CONFLICT_POSTING_OUTCOMES.has(outcome)
        || PRODUCT_NOT_READY_POSTING_OUTCOMES.has(outcome)
      ) {
        throw new CanonicalActualPostingError(outcome);
      }
      throw new Error('Unexpected canonical actual posting outcome.');
    } catch (error) {
      throw normalizePostingFailure(error);
    }
  }

  return Object.freeze({
    enabled: runtimeEnabled,
    assertEnabled,
    disabledPreview,
    listEligibleEvents,
    postEligibleEvent,
    readEventScope,
  });
}

module.exports = {
  CanonicalActualPostingProductError,
  PRODUCT_RUNTIME_DISABLED_MESSAGE,
  createCanonicalActualPostingProductService,
  normalizePostingFailure,
};
