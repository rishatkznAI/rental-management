const express = require('express');
const {
  buildFleetReadinessReport,
  buildManagementActionQueue,
  buildManagementActionQueueFromReadiness,
} = require('../lib/equipment-readiness');

const ACTION_STATE_COLLECTION = 'management_action_states';
const ACTION_EXECUTION_STATUSES = new Set(['open', 'in_progress', 'postponed', 'resolved', 'ignored']);
const TERMINAL_ACTION_STATUSES = new Set(['resolved', 'ignored']);
const MAX_ACTION_COMMENT_LENGTH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_ACTION_DAYS = 3;
const STALE_HIGH_LOSS_THRESHOLD = 50000;
const ACTION_EXECUTION_LABELS = {
  open: 'Открыто',
  in_progress: 'В работе',
  postponed: 'Отложено',
  resolved: 'Решено',
  ignored: 'Игнорировано',
};

function makeRequestId(req) {
  return String(req.headers?.['x-request-id'] || req.headers?.['x-railway-request-id'] || '').slice(0, 120)
    || `readiness-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function scopedCollection({ collection, req, readData, accessControl, canReadCollection }) {
  if (typeof canReadCollection === 'function' && !canReadCollection(req, collection)) return [];
  const raw = readData(collection) || [];
  const scoped = accessControl?.filterCollectionByScope
    ? accessControl.filterCollectionByScope(collection, raw, req.user)
    : raw;
  return accessControl?.sanitizeCollectionForRead
    ? accessControl.sanitizeCollectionForRead(collection, scoped, req.user)
    : scoped;
}

function internalCollection(readData, collection) {
  const data = readData(collection);
  return Array.isArray(data) ? data : [];
}

function managementActionAreasForUser(user, accessControl) {
  if (!user || !accessControl) return new Set();
  if (
    accessControl.isAdmin?.(user) ||
    accessControl.isOfficeManager?.(user) ||
    accessControl.isRentalManager?.(user) ||
    accessControl.isSalesManager?.(user)
  ) {
    return null;
  }
  if (accessControl.isServiceForeman?.(user) || accessControl.isMechanic?.(user)) {
    return new Set(['service', 'admin']);
  }
  if (accessControl.isCarrierDelivery && String(user.role || user.userRole || '').trim() === 'Перевозчик') {
    return new Set(['logistics']);
  }
  return new Set();
}

function filterActionQueueForUser(queue, user, accessControl) {
  const allowedAreas = managementActionAreasForUser(user, accessControl);
  if (allowedAreas === null) return queue;
  const items = queue.items.filter(item => allowedAreas.has(item.responsibleArea));
  return buildActionQueueSummary(items);
}

function canManageActionQueue(user, accessControl) {
  if (!user || !accessControl) return false;
  return Boolean(
    accessControl.isAdmin?.(user) ||
    accessControl.isOfficeManager?.(user) ||
    accessControl.isRentalManager?.(user) ||
    accessControl.isSalesManager?.(user)
  );
}

function todayDateString(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function actionSourceKey(action) {
  return action?.sourceKey || action?.equipmentId || '';
}

function stateKey(action) {
  return `${action?.actionId || ''}::${actionSourceKey(action)}`;
}

function normalizeActionState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = ACTION_EXECUTION_STATUSES.has(raw.status) ? raw.status : 'open';
  return {
    id: String(raw.id || ''),
    actionId: String(raw.actionId || ''),
    sourceType: String(raw.sourceType || 'equipment_readiness'),
    sourceKey: String(raw.sourceKey || raw.equipmentId || ''),
    equipmentId: String(raw.equipmentId || raw.sourceKey || ''),
    status,
    assignedToUserId: String(raw.assignedToUserId || ''),
    assignedToName: String(raw.assignedToName || ''),
    dueDate: String(raw.dueDate || ''),
    comment: String(raw.comment || '').slice(0, MAX_ACTION_COMMENT_LENGTH),
    updatedByUserId: String(raw.updatedByUserId || ''),
    updatedAt: String(raw.updatedAt || ''),
    createdAt: String(raw.createdAt || raw.updatedAt || ''),
  };
}

function readActionStates(readData) {
  return internalCollection(readData, ACTION_STATE_COLLECTION)
    .map(normalizeActionState)
    .filter(state => state && state.actionId);
}

function indexActionStates(states) {
  const byKey = new Map();
  for (const state of states) {
    byKey.set(`${state.actionId}::${state.sourceKey || state.equipmentId || ''}`, state);
  }
  return byKey;
}

function isActionOverdue(state, today = todayDateString()) {
  return Boolean(
    state?.dueDate &&
    state.dueDate < today &&
    !TERMINAL_ACTION_STATUSES.has(state.status)
  );
}

function parseDateKey(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return '';
  return text;
}

function daysBetweenDateKeys(left, right) {
  const leftKey = parseDateKey(left);
  const rightKey = parseDateKey(right);
  if (!leftKey || !rightKey) return null;
  return Math.round((new Date(`${leftKey}T00:00:00.000Z`).getTime() - new Date(`${rightKey}T00:00:00.000Z`).getTime()) / DAY_MS);
}

function isTerminalAction(status) {
  return TERMINAL_ACTION_STATUSES.has(status);
}

function actionUrgencyLabel(priority) {
  if (priority === 'critical') return 'Критично';
  if (priority === 'high') return 'Высокий';
  if (priority === 'medium') return 'Средний';
  return 'Низкий';
}

function actionAccountabilityLabel({ executionStatus, isUnassigned, isOverdue, isDueToday }) {
  if (executionStatus === 'resolved') return 'Решено';
  if (executionStatus === 'ignored') return 'Решено';
  if (isOverdue) return 'Просрочено';
  if (isDueToday) return 'Сегодня';
  if (executionStatus === 'in_progress') return 'В работе';
  if (isUnassigned) return 'Без ответственного';
  return actionExecutionLabel(executionStatus);
}

function actionSortScore(item) {
  const priorityScore = { critical: 30000, high: 20000, medium: 10000, low: 0 }[item.priority] || 0;
  const lossScore = Math.min(Number(item.estimatedLoss || 0), 9999999) / 100;
  const daysScore = Math.min(Number(item.blockedDays || 0), 365) * 10;
  return Math.round(
    (item.isOverdue ? 1000000 : 0)
    + priorityScore
    + lossScore
    + daysScore
    + (item.isUnassigned ? 500 : 0)
  );
}

function deriveActionExecutionFields(item, { today }) {
  const executionStatus = item.executionStatus || 'open';
  const dueDate = parseDateKey(item.dueDate);
  const daysUntilDue = dueDate ? daysBetweenDateKeys(dueDate, today) : null;
  const terminal = isTerminalAction(executionStatus);
  const isUnassigned = Boolean(
    !terminal &&
    (!String(item.assignedToUserId || '').trim() || !String(item.assignedToName || '').trim())
  );
  const isOverdue = Boolean(!terminal && dueDate && dueDate < today);
  const isDueToday = Boolean(!terminal && dueDate && dueDate === today);
  const updatedAgeDays = item.updatedAt ? daysBetweenDateKeys(today, item.updatedAt) : null;
  const isStale = Boolean(
    ['open', 'in_progress'].includes(executionStatus) &&
    (
      Number(item.blockedDays || 0) >= STALE_ACTION_DAYS ||
      (updatedAgeDays !== null && updatedAgeDays >= STALE_ACTION_DAYS) ||
      Number(item.estimatedLoss || 0) >= STALE_HIGH_LOSS_THRESHOLD
    )
  );
  const next = {
    ...item,
    dueDate,
    isUnassigned,
    isOverdue,
    isDueToday,
    isStale,
    daysUntilDue,
    accountabilityLabel: actionAccountabilityLabel({ executionStatus, isUnassigned, isOverdue, isDueToday }),
    urgencyLabel: actionUrgencyLabel(item.priority),
  };
  next.sortScore = actionSortScore(next);
  return next;
}

function actionExecutionLabel(status) {
  return ACTION_EXECUTION_LABELS[status] || ACTION_EXECUTION_LABELS.open;
}

function attachExecutionState(queue, states, { now = new Date() } = {}) {
  const byKey = indexActionStates(states);
  const today = todayDateString(now);
  const items = queue.items.map(item => {
    const sourceKey = actionSourceKey(item);
    const state = byKey.get(`${item.actionId}::${sourceKey}`) || null;
    const executionStatus = state?.status || 'open';
    return deriveActionExecutionFields({
      ...item,
      sourceKey,
      executionStatus,
      executionLabel: actionExecutionLabel(executionStatus),
      assignedToUserId: state?.assignedToUserId || '',
      assignedToName: state?.assignedToName || '',
      dueDate: state?.dueDate || '',
      executionComment: state?.comment || '',
      updatedAt: state?.updatedAt || '',
      executionOverdue: isActionOverdue(state, today),
    }, { today });
  }).sort((left, right) => {
    const scoreDiff = Number(right.sortScore || 0) - Number(left.sortScore || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const lossDiff = Number(right.estimatedLoss || 0) - Number(left.estimatedLoss || 0);
    if (lossDiff !== 0) return lossDiff;
    return Number(right.blockedDays || 0) - Number(left.blockedDays || 0);
  });
  return buildActionQueueSummary(items);
}

function buildActionQueueSummary(items) {
  const byResponsibleArea = {
    service: 0,
    logistics: 0,
    office: 0,
    rental_manager: 0,
    admin: 0,
    unknown: 0,
  };
  const summary = {
    total: items.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    totalEstimatedLoss: 0,
    totalDailyLoss: 0,
    unassigned: 0,
    overdue: 0,
    dueToday: 0,
    stale: 0,
    inProgress: 0,
    resolved: 0,
    byResponsibleArea,
  };
  const roundMoney = value => Math.round(value * 100) / 100;
  for (const item of items) {
    if (summary[item.priority] !== undefined) summary[item.priority] += 1;
    summary.totalEstimatedLoss = roundMoney(summary.totalEstimatedLoss + Number(item.estimatedLoss || 0));
    summary.totalDailyLoss = roundMoney(summary.totalDailyLoss + Number(item.estimatedDailyLoss || 0));
    if (item.isUnassigned) summary.unassigned += 1;
    if (item.isOverdue || item.executionOverdue) summary.overdue += 1;
    if (item.isDueToday) summary.dueToday += 1;
    if (item.isStale) summary.stale += 1;
    if (item.executionStatus === 'in_progress') summary.inProgress += 1;
    if (item.executionStatus === 'resolved') summary.resolved += 1;
    byResponsibleArea[item.responsibleArea] = (byResponsibleArea[item.responsibleArea] || 0) + 1;
  }
  return { summary, items };
}

function actionQueueContext({ readData, req, accessControl, canReadCollection }) {
  return {
    equipment: scopedCollection({ collection: 'equipment', req, readData, accessControl, canReadCollection }),
    rentals: internalCollection(readData, 'rentals'),
    ganttRentals: internalCollection(readData, 'gantt_rentals'),
    serviceTickets: internalCollection(readData, 'service'),
    deliveries: internalCollection(readData, 'deliveries'),
    documents: internalCollection(readData, 'documents'),
    gsmPackets: internalCollection(readData, 'gsm_packets'),
    shippingPhotos: internalCollection(readData, 'shipping_photos'),
  };
}

function contextCounts(context, actionStates = []) {
  return {
    equipment: context.equipment.length,
    rentals: context.rentals.length,
    ganttRentals: context.ganttRentals.length,
    service: context.serviceTickets.length,
    deliveries: context.deliveries.length,
    documents: context.documents.length,
    gsmPackets: context.gsmPackets.length,
    shippingPhotos: context.shippingPhotos.length,
    actionStates: actionStates.length,
  };
}

function logEndpointDiagnostic(logger, {
  endpoint,
  req,
  startedAt,
  counts,
  itemsReturned,
  statusCode = 200,
  warningMs = 2000,
}) {
  const durationMs = Date.now() - startedAt;
  const payload = {
    requestId: makeRequestId(req),
    endpoint,
    durationMs,
    statusCode,
    counts,
    itemsReturned,
  };
  const line = `[diagnostic] ${endpoint} ${JSON.stringify(payload)}`;
  if (durationMs > warningMs) {
    (logger?.warn || console.warn)(`${line} slow=true`);
  } else {
    (logger?.log || console.log)(line);
  }
}

function isActiveUserRecord(user) {
  const status = String(user?.status || user?.state || '').trim().toLowerCase();
  const active = user?.active;
  if (active === false) return false;
  if (status && ['inactive', 'disabled', 'blocked', 'уволен', 'неактивен', 'заблокирован'].includes(status)) return false;
  if (active === true) return true;
  return ['active', 'enabled', 'активен'].includes(status);
}

function safeActionQueueAssignees(readData) {
  return internalCollection(readData, 'users')
    .filter(isActiveUserRecord)
    .map(user => ({
      userId: String(user.id || user.userId || ''),
      name: String(user.name || user.userName || '').trim(),
      role: String(user.role || user.userRole || '').trim(),
      active: true,
    }))
    .filter(user => user.userId && user.name)
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

function registerEquipmentReadinessRoutes(deps) {
  const {
    readData,
    writeData,
    requireAuth,
    requireRead,
    canReadCollection,
    accessControl,
    auditLog,
    logger = console,
  } = deps;

  const router = express.Router();

  router.get('/equipment/readiness', requireAuth, requireRead('equipment'), (req, res) => {
    const startedAt = Date.now();
    const context = actionQueueContext({ readData, req, accessControl, canReadCollection });
    const report = buildFleetReadinessReport(context);
    logEndpointDiagnostic(logger, {
      endpoint: '/api/equipment/readiness',
      req,
      startedAt,
      counts: contextCounts(context),
      itemsReturned: report.items.length,
    });

    return res.json({
      ok: true,
      summary: report.summary,
      items: report.items,
    });
  });

  router.get('/management/action-queue', requireAuth, (req, res) => {
    const startedAt = Date.now();
    const context = actionQueueContext({ readData, req, accessControl, canReadCollection });
    const report = buildFleetReadinessReport(context);
    const queue = buildManagementActionQueueFromReadiness(report.items);
    const states = readActionStates(readData);
    const queueWithState = attachExecutionState(queue, states);
    const visibleQueue = filterActionQueueForUser(queueWithState, req.user, accessControl);
    logEndpointDiagnostic(logger, {
      endpoint: '/api/management/action-queue',
      req,
      startedAt,
      counts: contextCounts(context, states),
      itemsReturned: visibleQueue.items.length,
    });
    return res.json({
      ok: true,
      summary: visibleQueue.summary,
      items: visibleQueue.items,
    });
  });

  router.get('/management/action-queue/assignees', requireAuth, (req, res) => {
    if (!canManageActionQueue(req.user, accessControl)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    return res.json({
      ok: true,
      items: safeActionQueueAssignees(readData),
    });
  });

  router.patch('/management/action-queue/:actionId/state', requireAuth, (req, res) => {
    if (typeof writeData !== 'function') {
      return res.status(500).json({ ok: false, error: 'Action state storage is unavailable' });
    }
    const actionId = String(req.params.actionId || '');
    const queue = buildManagementActionQueue(actionQueueContext({ readData, req, accessControl, canReadCollection }));
    const action = queue.items.find(item => item.actionId === actionId);
    if (!action) return res.status(404).json({ ok: false, error: 'Action not found' });

    const visibleQueue = filterActionQueueForUser(queue, req.user, accessControl);
    if (!visibleQueue.items.some(item => item.actionId === actionId)) {
      return res.status(403).json({ ok: false, error: 'Forbidden: action is outside user scope' });
    }

    const status = String(req.body?.status || '').trim();
    if (!ACTION_EXECUTION_STATUSES.has(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid action execution status' });
    }

    const dueDate = String(req.body?.dueDate || '').trim();
    if (dueDate) {
      const parsed = new Date(`${dueDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dueDate) {
        return res.status(400).json({ ok: false, error: 'Invalid dueDate' });
      }
    }

    const assignedToUserId = String(req.body?.assignedToUserId || '').trim();
    const users = internalCollection(readData, 'users');
    const assignedUser = assignedToUserId ? users.find(user => String(user.id) === assignedToUserId) : null;
    const assignedToName = assignedUser?.name
      ? String(assignedUser.name)
      : String(req.body?.assignedToName || '').trim().slice(0, 120);
    const comment = String(req.body?.comment || '').trim().slice(0, MAX_ACTION_COMMENT_LENGTH);
    const nowIso = new Date().toISOString();
    const states = readActionStates(readData);
    const key = stateKey(action);
    const previousIndex = states.findIndex(state => stateKey(state) === key);
    const previous = previousIndex >= 0 ? states[previousIndex] : null;
    const next = {
      id: previous?.id || `management_action_state:${action.sourceType}:${actionSourceKey(action)}:${Date.now()}`,
      actionId,
      sourceType: action.sourceType || 'equipment_readiness',
      sourceKey: actionSourceKey(action),
      equipmentId: action.equipmentId || actionSourceKey(action),
      status,
      assignedToUserId,
      assignedToName,
      dueDate,
      comment,
      updatedByUserId: req.user?.userId || '',
      updatedAt: nowIso,
      createdAt: previous?.createdAt || nowIso,
    };
    const nextStates = previousIndex >= 0
      ? states.map((state, index) => index === previousIndex ? next : state)
      : [...states, next];
    writeData(ACTION_STATE_COLLECTION, nextStates);
    auditLog?.(req, {
      action: 'management_action_state.update',
      entityType: ACTION_STATE_COLLECTION,
      entityId: next.id,
      before: previous ? { status: previous.status, assignedToUserId: previous.assignedToUserId, dueDate: previous.dueDate } : null,
      after: { status: next.status, assignedToUserId: next.assignedToUserId, dueDate: next.dueDate },
      metadata: { actionId, sourceKey: next.sourceKey },
    });

    return res.json({
      ok: true,
      state: {
        actionId: next.actionId,
        sourceType: next.sourceType,
        sourceKey: next.sourceKey,
        equipmentId: next.equipmentId,
        executionStatus: next.status,
        executionLabel: actionExecutionLabel(next.status),
        assignedToUserId: next.assignedToUserId,
        assignedToName: next.assignedToName,
        dueDate: next.dueDate,
        executionComment: next.comment,
        updatedAt: next.updatedAt,
        executionOverdue: isActionOverdue(next),
      },
    });
  });

  return router;
}

module.exports = {
  registerEquipmentReadinessRoutes,
  attachExecutionState,
  isActionOverdue,
  actionExecutionLabel,
};
