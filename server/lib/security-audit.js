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
  'date',
  'returnDate',
  'startDate',
  'endDate',
  'plannedReturnDate',
  'actualReturnDate',
  'paymentStatus',
  'amount',
  'paidAmount',
  'currency',
  'priority',
  'source',
  'createdAt',
  'updatedAt',
  'archived',
  'hasDamage',
  'serviceTicketId',
  'equipmentStatus',
  'count',
  'collections',
  'imported',
  'warnings',
  'conflicts',
  'strippedSensitiveFields',
  'dryRun',
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
  return Array.isArray(value) ? value : [];
}

function createAuditLogger({
  readData,
  writeData,
  generateId = prefix => `${prefix}-${Date.now()}`,
  nowIso = () => new Date().toISOString(),
  logger = console,
}) {
  return function auditLog(reqOrUser, {
    action,
    entityType,
    entityId,
    before = null,
    after = null,
    metadata = null,
  } = {}) {
    try {
      if (!action || !entityType) return null;
      const user = reqOrUser?.user || reqOrUser || {};
      const headers = reqOrUser?.headers || {};
      const entry = {
        id: generateId('AUD'),
        userId: user.userId || user.id || null,
        userName: user.userName || user.name || null,
        role: user.userRole || user.role || null,
        rawRole: user.rawRole || user.role || null,
        normalizedRole: user.normalizedRole || user.userRole || user.role || null,
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
      const log = normalizeAuditLogList(readData(AUDIT_COLLECTION));
      log.push(entry);
      writeData(AUDIT_COLLECTION, log.slice(-10000));
      return entry;
    } catch (error) {
      logger.warn?.('[AUDIT] Не удалось записать audit log:', error?.message || error);
      return null;
    }
  };
}

module.exports = {
  createAuditLogger,
  redactAuditValue,
  AUDIT_COLLECTION,
  LEGACY_AUDIT_COLLECTION,
};
