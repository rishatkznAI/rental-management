const SECRET_FIELD_PATTERN = /(password|passhash|token|secret|apikey|api_key|authorization|cookie|session|webhook)/i;
const AUDIT_COLLECTION = 'audit_logs';
const LEGACY_AUDIT_COLLECTION = 'audit_log';

const SAFE_FIELD_ALLOWLIST = new Set([
  'id',
  'name',
  'email',
  'role',
  'rawRole',
  'normalizedRole',
  'status',
  'type',
  'number',
  'client',
  'clientId',
  'rental',
  'rentalId',
  'equipment',
  'equipmentId',
  'equipmentInv',
  'inventoryNumber',
  'serialNumber',
  'manager',
  'managerId',
  'responsibleUserId',
  'responsibleName',
  'date',
  'returnDate',
  'startDate',
  'endDate',
  'plannedReturnDate',
  'oldPlannedReturnDate',
  'newPlannedReturnDate',
  'actualReturnDate',
  'paymentStatus',
  'amount',
  'price',
  'discount',
  'rate',
  'paidAmount',
  'currency',
  'priority',
  'lastContactDate',
  'promisedPaymentDate',
  'nextActionDate',
  'nextActionType',
  'comment',
  'result',
  'reason',
  'source',
  'createdAt',
  'updatedAt',
  'archived',
  'hasDamage',
  'serviceTicketId',
  'equipmentStatus',
  'attemptedFields',
  'violations',
  'userEmail',
  'count',
  'collections',
  'imported',
  'warnings',
  'conflicts',
  'conflict',
  'strippedSensitiveFields',
  'dryRun',
  'filename',
  'size',
  'files',
  'linked',
  'missingLink',
  'ambiguous',
  'unresolved',
  'revokedSessions',
  'tokenVersion',
  'passwordChangedAt',
]);

function actionLabel(action) {
  const value = String(action || '');
  if (value === 'login.success') return 'Вход в систему';
  if (value === 'login.fail') return 'Неудачный вход';
  if (value === 'logout') return 'Выход из системы';
  if (value === 'system_data.export') return 'Экспорт системных данных';
  if (value === 'system_data.import') return 'Импорт системных данных';
  if (value === 'rentals.return') return 'Возврат аренды';
  if (value === 'users.deactivate') return 'Деактивация пользователя';
  if (value === 'users.status_change') return 'Смена статуса пользователя';
  if (value === 'debt_collection_plans.status_change') return 'Смена статуса взыскания';
  if (value === 'debt_collection_plans.close') return 'Закрытие плана взыскания';
  if (value === 'debt_collection_plans.comment') return 'Комментарий по взысканию';
  if (value.endsWith('.create')) return 'Создание записи';
  if (value.endsWith('.update')) return 'Изменение записи';
  if (value.endsWith('.delete')) return 'Удаление записи';
  if (value.endsWith('.bulk_replace')) return 'Массовое обновление';
  return value;
}

function redactAuditValue(value, depth = 0) {
  if (depth > 4) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(item => redactAuditValue(item, depth + 1));
  }
  return Object.entries(value).reduce((acc, [key, item]) => {
    if (SECRET_FIELD_PATTERN.test(key)) return acc;
    if (depth === 0 && !SAFE_FIELD_ALLOWLIST.has(key)) return acc;
    acc[key] = redactAuditValue(item, depth + 1);
    return acc;
  }, {});
}

function collectChangedFields(before, after) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter(key => !SECRET_FIELD_PATTERN.test(key))
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .slice(0, 20);
}

function buildAuditDescription({ action, entityType, entityId, before, after, metadata }) {
  const changed = collectChangedFields(before, after);
  if (changed.length > 0) {
    return `${actionLabel(action)}: ${entityType}${entityId ? ` ${entityId}` : ''}; поля: ${changed.join(', ')}`;
  }
  if (metadata?.reason) return `${actionLabel(action)}: ${metadata.reason}`;
  return `${actionLabel(action)}: ${entityType}${entityId ? ` ${entityId}` : ''}`;
}

function normalizeAuditLogList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  const error = new Error('Stored audit history is malformed; refusing to overwrite it.');
  error.code = 'AUDIT_HISTORY_SHAPE_INVALID';
  error.status = 409;
  throw error;
}

function createAuditEntry(reqOrUser, {
  action,
  entityType,
  entityId,
  before = null,
  after = null,
  metadata = null,
} = {}, {
  generateId = prefix => `${prefix}-${Date.now()}`,
  nowIso = () => new Date().toISOString(),
  auditKind = null,
} = {}) {
  if (!action || !entityType) return null;
  const user = reqOrUser?.user || reqOrUser || {};
  const headers = reqOrUser?.headers || {};
  // Scope is accepted only from the trusted resolver output attached to the
  // request. Mutable user/profile fields are display metadata, not authority.
  const companyId = String(reqOrUser?.actorScope?.companyId || '').trim();
  const tenantId = String(reqOrUser?.actorScope?.tenantId || '').trim();
  const trustedScope = companyId && tenantId && companyId === tenantId
    ? { companyId, tenantId }
    : null;
  if (!trustedScope && auditKind !== 'GLOBAL_SYSTEM') {
    const error = new Error('Audit events require exact tenant scope or an explicit system-audit path.');
    error.code = 'AUDIT_SCOPE_REQUIRED';
    error.status = 403;
    throw error;
  }
  if (trustedScope && auditKind === 'GLOBAL_SYSTEM') {
    const error = new Error('Tenant requests cannot be downgraded to global system audit events.');
    error.code = 'AUDIT_SCOPE_CONFLICT';
    error.status = 403;
    throw error;
  }
  return {
    id: generateId('AUD'),
    userId: user.userId || user.id || null,
    userName: user.userName || user.name || null,
    role: user.userRole || user.role || null,
    rawRole: user.rawRole || user.role || null,
    normalizedRole: user.normalizedRole || user.userRole || user.role || null,
    ...(trustedScope || {}),
    auditKind: trustedScope ? 'TENANT' : 'GLOBAL_SYSTEM',
    action,
    entityType,
    entityId: entityId || null,
    description: buildAuditDescription({ action, entityType, entityId, before, after, metadata }),
    before: redactAuditValue(before),
    after: redactAuditValue(after),
    metadata: redactAuditValue(metadata),
    ip: headers['x-forwarded-for']
      ? String(headers['x-forwarded-for']).split(',')[0].trim()
      : (reqOrUser?.ip || reqOrUser?.socket?.remoteAddress || null),
    userAgent: headers['user-agent'] || null,
    createdAt: nowIso(),
  };
}

function createAuditLogger({
  readData,
  writeData,
  generateId = prefix => `${prefix}-${Date.now()}`,
  nowIso = () => new Date().toISOString(),
  withTenantScope = (_scope, operation) => operation(),
  withSystemScope = operation => operation(),
}) {
  function buildEntry(reqOrUser, event, auditKind = null) {
    const {
      action,
      entityType,
      entityId,
      before = null,
      after = null,
      metadata = null,
    } = event || {};
    return createAuditEntry(reqOrUser, {
      action,
      entityType,
      entityId,
      before,
      after,
      metadata,
    }, { generateId, nowIso, auditKind });
  }

  function appendPreparedEntries(entries) {
    return [...normalizeAuditLogList(readData(AUDIT_COLLECTION)), ...entries];
  }

  function preparePersistenceEntry(reqOrUser, events, auditKind = null) {
    const prepared = (Array.isArray(events) ? events : [events])
      .map(event => buildEntry(reqOrUser, event, auditKind))
      .filter(Boolean);
    if (prepared.length === 0) return null;
    return {
      name: AUDIT_COLLECTION,
      value: appendPreparedEntries(prepared),
      auditEntries: prepared,
    };
  }

  function buildAndPersist(reqOrUser, event, auditKind = null) {
    const entry = buildEntry(reqOrUser, event, auditKind);
    if (!entry) return null;
    const persist = () => {
      writeData(AUDIT_COLLECTION, appendPreparedEntries([entry]));
      return entry;
    };
    if (entry.auditKind === 'TENANT') {
      return withTenantScope({ companyId: entry.companyId, tenantId: entry.tenantId }, persist);
    }
    return withSystemScope(persist);
  }

  function auditLog(reqOrUser, event = {}) {
    return buildAndPersist(reqOrUser, event, null);
  }
  auditLog.system = (reqOrUser, event = {}) => buildAndPersist(reqOrUser, event, 'GLOBAL_SYSTEM');
  auditLog.buildEntry = (reqOrUser, event = {}) => buildEntry(reqOrUser, event, null);
  auditLog.preparePersistenceEntry = (reqOrUser, events = []) => preparePersistenceEntry(reqOrUser, events, null);
  return auditLog;
}

module.exports = {
  createAuditEntry,
  createAuditLogger,
  redactAuditValue,
  AUDIT_COLLECTION,
  LEGACY_AUDIT_COLLECTION,
};
