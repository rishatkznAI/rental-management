const { isMechanicRole, normalizeRole } = require('./role-groups');

const SERVICE_REPAIR_ITEMS_ADMIN_MESSAGE = 'Недостаточно прав. Работы и запчасти может изменять только администратор';
const SERVICE_AUDIT_COLLECTION = 'service_audit_log';
const SERVICE_AUDIT_SOURCES = new Set(['web', 'api', 'bot', 'sync']);

function normalizeServiceAuditLogList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  const error = new Error('Stored service audit history is malformed; refusing to overwrite it.');
  error.code = 'SERVICE_AUDIT_HISTORY_SHAPE_INVALID';
  error.status = 409;
  throw error;
}

function auditedServiceMutationError(message) {
  const error = new Error(message);
  error.code = 'SERVICE_ATOMIC_AUDIT_REQUIRED';
  error.status = 503;
  return error;
}

function prepareServiceMutationAuditEntries({
  reqOrUser,
  serviceEvents = [],
  securityEvents = [],
  serviceAuditLog,
  auditLog,
} = {}) {
  const entries = [];
  if (serviceEvents.length > 0) {
    if (typeof serviceAuditLog?.preparePersistenceEntry !== 'function') {
      throw auditedServiceMutationError('Service semantic audit repository is unavailable.');
    }
    const prepared = serviceAuditLog.preparePersistenceEntry(reqOrUser, serviceEvents);
    if (!prepared) throw auditedServiceMutationError('Service semantic audit event is incomplete.');
    entries.push({ name: prepared.name, value: prepared.value });
  }
  if (securityEvents.length > 0) {
    if (typeof auditLog?.preparePersistenceEntry !== 'function') {
      throw auditedServiceMutationError('Security audit repository is unavailable.');
    }
    const prepared = auditLog.preparePersistenceEntry(reqOrUser, securityEvents);
    if (!prepared) throw auditedServiceMutationError('Security audit event is incomplete.');
    entries.push({ name: prepared.name, value: prepared.value });
  }
  return entries;
}

function prepareAuditedServiceMutationEntries({
  businessEntries = [],
  ...auditOptions
} = {}) {
  if (!Array.isArray(businessEntries) || businessEntries.length === 0) {
    throw auditedServiceMutationError('Service mutation requires staged business entries.');
  }
  const entries = [
    ...businessEntries.map(entry => ({ name: entry.name, value: entry.value })),
    ...prepareServiceMutationAuditEntries(auditOptions),
  ];
  const names = entries.map(entry => entry.name);
  if (new Set(names).size !== names.length) {
    throw auditedServiceMutationError('Service mutation contains duplicate staged collections.');
  }
  return entries;
}

function isRepairItemCollection(collection) {
  return collection === 'repair_work_items' || collection === 'repair_part_items';
}

function sameText(left, right) {
  const l = String(left || '').trim().toLowerCase();
  const r = String(right || '').trim().toLowerCase();
  return Boolean(l && r && l === r);
}

function compact(values) {
  return values
    .flat()
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function getMechanicIdsForUser(user, readData) {
  if (typeof readData !== 'function') return [];
  const mechanics = readData('mechanics') || [];
  const keys = compact([user?.userId, user?.id, user?.userName, user?.name, user?.email]);
  return compact([
    ...mechanics
      .filter(item => keys.some(key => (
        sameText(key, item?.id) ||
        sameText(key, item?.userId) ||
        sameText(key, item?.name) ||
        sameText(key, item?.email)
      )))
      .map(item => item.id),
  ]);
}

function isEditableRepairItemTicket(ticket) {
  const status = String(ticket?.status || '').trim();
  return status !== 'closed' && status !== 'ready';
}

function mechanicCanAddRepairItemToTicket(user, context = {}) {
  if (!isMechanicRole(user?.userRole || user?.role || '')) return false;
  const ticket = context.ticket || (() => {
    const repairId = String(context.input?.repairId || context.input?.serviceId || '').trim();
    if (!repairId || typeof context.readData !== 'function') return null;
    return (context.readData('service') || []).find(item => String(item?.id || '') === repairId) || null;
  })();
  if (!ticket || !isEditableRepairItemTicket(ticket)) return false;
  const userKeys = [
    user?.userId,
    user?.id,
    user?.userName,
    user?.name,
    user?.email,
    ...getMechanicIdsForUser(user, context.readData),
  ];
  const ticketKeys = [
    ticket.assignedMechanicId,
    ticket.mechanicId,
    ticket.assignedUserId,
    ticket.assignedToId,
    ticket.assignedMechanicName,
    ticket.assignedTo,
  ];
  return userKeys.some(left => ticketKeys.some(right => sameText(left, right)));
}

function mechanicCanAppendRepairItemFromBot(user, context = {}) {
  if (context.source !== 'bot') return false;
  if (!isMechanicRole(user?.userRole || user?.role || '')) return false;
  const ticket = context.ticket || (() => {
    const repairId = String(context.input?.repairId || context.input?.serviceId || '').trim();
    if (!repairId || typeof context.readData !== 'function') return null;
    return (context.readData('service') || []).find(item => String(item?.id || '') === repairId) || null;
  })();
  return Boolean(ticket && isEditableRepairItemTicket(ticket));
}

function assertRepairItemsAdmin(user, context = {}) {
  const role = normalizeRole(user?.userRole || user?.role || '');
  if (role === 'Администратор') return;
  if (context.mode === 'create') {
    if (mechanicCanAppendRepairItemFromBot(user, context)) return;
    if (mechanicCanAddRepairItemToTicket(user, context)) return;
  }
  const error = new Error(SERVICE_REPAIR_ITEMS_ADMIN_MESSAGE);
  error.status = 403;
  throw error;
}

function inferServiceAuditSource(req, fallback = 'api') {
  // Request payload, query parameters, and headers are attacker-controlled and
  // therefore cannot choose an audit provenance. Bot/sync callers set their
  // source explicitly when they build an internal audit event.
  void req;
  const trustedFallback = String(fallback || '').trim().toLowerCase();
  return SERVICE_AUDIT_SOURCES.has(trustedFallback) ? trustedFallback : 'api';
}

function compactSnapshot(item = {}) {
  const snapshot = { ...item };
  if (!snapshot.name && item.nameSnapshot) snapshot.name = item.nameSnapshot;
  if (!snapshot.price && item.priceSnapshot != null) snapshot.price = item.priceSnapshot;
  if (!snapshot.cost && item.ratePerHourSnapshot != null) snapshot.cost = item.ratePerHourSnapshot;
  if (!snapshot.comment && item.comment == null && item.notes != null) snapshot.comment = item.notes;
  return snapshot;
}

function createServiceAuditEntry(reqOrUser, {
  serviceId,
  action,
  entityType,
  entityId,
  snapshot,
  source = 'api',
}, { generateId, nowIso } = {}) {
  if (!serviceId || !action || !entityType || !entityId) return null;
  const user = reqOrUser?.user || reqOrUser || {};
  return {
    id: generateId ? generateId('audit') : `audit-${Date.now()}`,
    serviceId,
    action,
    entityType,
    entityId,
    snapshot: compactSnapshot(snapshot),
    actor: {
      id: user.userId || user.id || null,
      name: user.userName || user.name || null,
      role: normalizeRole(user.userRole || user.role || ''),
    },
    source: SERVICE_AUDIT_SOURCES.has(source) ? source : 'api',
    createdAt: nowIso ? nowIso() : new Date().toISOString(),
  };
}

function createServiceAuditLog({ readData, writeData, generateId, nowIso }) {
  function buildEntry(reqOrUser, {
    serviceId,
    action,
    entityType,
    entityId,
    snapshot,
    source = 'api',
  }) {
    return createServiceAuditEntry(reqOrUser, {
      serviceId,
      action,
      entityType,
      entityId,
      snapshot,
      source,
    }, { generateId, nowIso });
  }
  function appendServiceAuditLog(reqOrUser, event) {
    const entry = buildEntry(reqOrUser, event || {});
    if (!entry) return null;
    const log = normalizeServiceAuditLogList(readData(SERVICE_AUDIT_COLLECTION));
    writeData(SERVICE_AUDIT_COLLECTION, [...log, entry]);
    return entry;
  }
  appendServiceAuditLog.buildEntry = buildEntry;
  appendServiceAuditLog.preparePersistenceEntry = (reqOrUser, events = []) => {
    const entries = (Array.isArray(events) ? events : [events])
      .map(event => buildEntry(reqOrUser, event || {}))
      .filter(Boolean);
    if (entries.length === 0) return null;
    return {
      name: SERVICE_AUDIT_COLLECTION,
      value: [
        ...normalizeServiceAuditLogList(readData(SERVICE_AUDIT_COLLECTION)),
        ...entries,
      ],
      auditEntries: entries,
    };
  };
  return appendServiceAuditLog;
}

module.exports = {
  SERVICE_AUDIT_COLLECTION,
  SERVICE_REPAIR_ITEMS_ADMIN_MESSAGE,
  assertRepairItemsAdmin,
  compactSnapshot,
  createServiceAuditEntry,
  createServiceAuditLog,
  inferServiceAuditSource,
  isRepairItemCollection,
  mechanicCanAppendRepairItemFromBot,
  mechanicCanAddRepairItemToTicket,
  normalizeServiceAuditLogList,
  prepareAuditedServiceMutationEntries,
  prepareServiceMutationAuditEntries,
};
