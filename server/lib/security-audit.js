const SECRET_FIELD_PATTERN = /(password|token|secret|authorization|cookie|session)/i;

function redactAuditValue(value, depth = 0) {
  if (depth > 4) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(item => redactAuditValue(item, depth + 1));
  }
  return Object.entries(value).reduce((acc, [key, item]) => {
    acc[key] = SECRET_FIELD_PATTERN.test(key)
      ? '[redacted]'
      : redactAuditValue(item, depth + 1);
    return acc;
  }, {});
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
        action,
        entityType,
        entityId: entityId || null,
        before: redactAuditValue(before),
        after: redactAuditValue(after),
        metadata: redactAuditValue(metadata),
        ip: headers['x-forwarded-for']
          ? String(headers['x-forwarded-for']).split(',')[0].trim()
          : (reqOrUser?.ip || reqOrUser?.socket?.remoteAddress || null),
        userAgent: headers['user-agent'] || null,
        createdAt: nowIso(),
      };
      const log = readData('audit_log') || [];
      log.push(entry);
      writeData('audit_log', log.slice(-10000));
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
};
