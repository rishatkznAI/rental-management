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
    return {
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
    };
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
    byResponsibleArea,
  };
  const roundMoney = value => Math.round(value * 100) / 100;
  for (const item of items) {
    if (summary[item.priority] !== undefined) summary[item.priority] += 1;
    summary.totalEstimatedLoss = roundMoney(summary.totalEstimatedLoss + Number(item.estimatedLoss || 0));
    summary.totalDailyLoss = roundMoney(summary.totalDailyLoss + Number(item.estimatedDailyLoss || 0));
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
