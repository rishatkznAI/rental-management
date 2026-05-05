const { isMechanicRole, normalizeRole } = require('./role-groups');

const SERVICE_REPAIR_ITEMS_ADMIN_MESSAGE = 'Недостаточно прав. Работы и запчасти может изменять только администратор';
const SERVICE_AUDIT_COLLECTION = 'service_audit_log';
const SERVICE_AUDIT_SOURCES = new Set(['web', 'api', 'bot', 'sync']);

function isRepairItemCollection(collection) {
  return collection === 'repair_work_items' || collection === 'repair_part_items';
}

function sameText(left, right) {
  const l = String(left || '').trim().toLowerCase();
  const r = String(right || '').trim().toLowerCase();
  return Boolean(l && r && l === r);
}

function mechanicCanAddRepairItemDuringRevision(user, context = {}) {
  if (!isMechanicRole(user?.userRole || user?.role || '')) return false;
  const ticket = context.ticket || (() => {
    const repairId = String(context.input?.repairId || context.input?.serviceId || '').trim();
    if (!repairId || typeof context.readData !== 'function') return null;
    return (context.readData('service') || []).find(item => String(item?.id || '') === repairId) || null;
  })();
  if (!ticket || ticket.status !== 'needs_revision') return false;
  const userKeys = [
    user?.userId,
    user?.id,
    user?.userName,
    user?.name,
    user?.email,
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

function assertRepairItemsAdmin(user, context = {}) {
  if (normalizeRole(user?.userRole || user?.role || '') === 'Администратор') return;
  if (context.mode === 'create' && mechanicCanAddRepairItemDuringRevision(user, context)) return;
  const error = new Error(SERVICE_REPAIR_ITEMS_ADMIN_MESSAGE);
  error.status = 403;
  throw error;
}

function inferServiceAuditSource(req, fallback = 'api') {
  const raw = req?.body?.source || req?.query?.source || req?.headers?.['x-skytech-source'] || fallback;
  const source = String(raw || '').trim().toLowerCase();
  return SERVICE_AUDIT_SOURCES.has(source) ? source : fallback;
}

function compactSnapshot(item = {}) {
  const snapshot = { ...item };
  if (!snapshot.name && item.nameSnapshot) snapshot.name = item.nameSnapshot;
  if (!snapshot.price && item.priceSnapshot != null) snapshot.price = item.priceSnapshot;
  if (!snapshot.cost && item.ratePerHourSnapshot != null) snapshot.cost = item.ratePerHourSnapshot;
  if (!snapshot.comment && item.comment == null && item.notes != null) snapshot.comment = item.notes;
  return snapshot;
}

function createServiceAuditLog({ readData, writeData, generateId, nowIso }) {
  return function appendServiceAuditLog(reqOrUser, {
    serviceId,
    action,
    entityType,
    entityId,
    snapshot,
    source = 'api',
  }) {
    if (!serviceId || !action || !entityType || !entityId) return null;
    const user = reqOrUser?.user || reqOrUser || {};
    const entry = {
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
    const log = Array.isArray(readData(SERVICE_AUDIT_COLLECTION)) ? readData(SERVICE_AUDIT_COLLECTION) : [];
    writeData(SERVICE_AUDIT_COLLECTION, [...log, entry]);
    return entry;
  };
}

module.exports = {
  SERVICE_AUDIT_COLLECTION,
  SERVICE_REPAIR_ITEMS_ADMIN_MESSAGE,
  assertRepairItemsAdmin,
  compactSnapshot,
  createServiceAuditLog,
  inferServiceAuditSource,
  isRepairItemCollection,
  mechanicCanAddRepairItemDuringRevision,
};
