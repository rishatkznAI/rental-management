const express = require('express');

const COLLECTION = 'debt_collection_plans';

const STATUSES = new Set(['new', 'contacted', 'promised', 'partial_paid', 'disputed', 'escalation', 'legal', 'closed']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const ACTION_TYPES = new Set(['call', 'message', 'email', 'documents', 'restrict_equipment', 'claim', 'meeting', 'wait_payment', 'other']);

const SAFE_PLAN_FIELDS = [
  'clientId',
  'clientName',
  'responsibleUserId',
  'responsibleName',
  'status',
  'priority',
  'lastContactDate',
  'promisedPaymentDate',
  'nextActionDate',
  'nextActionType',
  'comment',
  'result',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function dateOnly(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function pickSafePlanFields(input = {}) {
  return SAFE_PLAN_FIELDS.reduce((acc, field) => {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      acc[field] = input[field];
    }
    return acc;
  }, {});
}

function findClient(readData, clientId, clientName) {
  const clients = Array.isArray(readData('clients')) ? readData('clients') : [];
  const id = normalizeText(clientId);
  if (id) {
    const byId = clients.find(client => normalizeText(client?.id) === id);
    if (byId) return byId;
  }
  const name = normalizeText(clientName).toLowerCase();
  if (!name) return null;
  return clients.find(client => normalizeText(client?.company).toLowerCase() === name) || null;
}

function normalizePlan(input, { previous = null, req, readData, generateId, idPrefix, nowIso }) {
  const safe = pickSafePlanFields(input);
  const now = nowIso();
  const client = findClient(readData, safe.clientId ?? previous?.clientId, safe.clientName ?? previous?.clientName);
  const clientId = normalizeText(safe.clientId ?? previous?.clientId ?? client?.id);
  const clientName = normalizeText(client?.company ?? safe.clientName ?? previous?.clientName);

  if (!clientId && !clientName) {
    const error = new Error('Укажите клиента для плана взыскания.');
    error.status = 400;
    throw error;
  }

  const status = normalizeText(safe.status ?? previous?.status ?? 'new');
  const priority = normalizeText(safe.priority ?? previous?.priority ?? 'medium');
  const nextActionType = normalizeText(safe.nextActionType ?? previous?.nextActionType ?? 'call');

  if (!STATUSES.has(status)) {
    const error = new Error('Некорректный статус плана взыскания.');
    error.status = 400;
    throw error;
  }
  if (!PRIORITIES.has(priority)) {
    const error = new Error('Некорректный приоритет плана взыскания.');
    error.status = 400;
    throw error;
  }
  if (!ACTION_TYPES.has(nextActionType)) {
    const error = new Error('Некорректный тип следующего действия.');
    error.status = 400;
    throw error;
  }

  return {
    ...(previous || {}),
    id: previous?.id || normalizeText(input?.id) || generateId(idPrefix),
    clientId: clientId || undefined,
    clientName: clientName || 'Клиент не указан',
    responsibleUserId: normalizeText(safe.responsibleUserId ?? previous?.responsibleUserId) || undefined,
    responsibleName: normalizeText(safe.responsibleName ?? previous?.responsibleName) || undefined,
    status,
    priority,
    lastContactDate: dateOnly(safe.lastContactDate ?? previous?.lastContactDate) || undefined,
    promisedPaymentDate: dateOnly(safe.promisedPaymentDate ?? previous?.promisedPaymentDate) || undefined,
    nextActionDate: dateOnly(safe.nextActionDate ?? previous?.nextActionDate) || undefined,
    nextActionType,
    comment: normalizeText(safe.comment ?? previous?.comment) || undefined,
    result: normalizeText(safe.result ?? previous?.result) || undefined,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    createdBy: previous?.createdBy || req.user?.userName || req.user?.email || undefined,
    updatedBy: req.user?.userName || req.user?.email || undefined,
  };
}

function accessError(res, error) {
  return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
}

function canViewFinance(req, canReadCollection) {
  return canReadCollection(req, 'payments') || canReadCollection(req, 'company_expenses');
}

function filterPlans(plans, req, accessControl) {
  if (accessControl?.isAdmin?.(req.user) || accessControl?.isOfficeManager?.(req.user)) {
    return plans;
  }
  return plans.filter(plan => accessControl.canAccessEntity(COLLECTION, plan, req.user));
}

function auditPlanChange(auditLog, req, action, previous, next, metadata = null) {
  auditLog?.(req, {
    action,
    entityType: COLLECTION,
    entityId: next?.id || previous?.id,
    before: previous ? pickSafePlanFields(previous) : null,
    after: next ? pickSafePlanFields(next) : null,
    metadata,
  });
}

function publicPlan(plan) {
  return {
    id: plan?.id,
    ...pickSafePlanFields(plan),
  };
}

function registerDebtCollectionPlanRoutes(deps) {
  const {
    readData,
    writeData,
    requireAuth,
    requireRead,
    requireWrite,
    canReadCollection,
    accessControl,
    auditLog,
    generateId,
    idPrefixes = {},
    nowIso = () => new Date().toISOString(),
  } = deps;

  const router = express.Router();
  const idPrefix = idPrefixes[COLLECTION] || 'DCP';

  router.get('/debt-collection-plans', requireAuth, requireRead(COLLECTION), (req, res) => {
    try {
      accessControl.assertCanReadCollection(COLLECTION, req.user);
      const plans = Array.isArray(readData(COLLECTION)) ? readData(COLLECTION) : [];
      const scoped = accessControl.sanitizeCollectionForRead(
        COLLECTION,
        filterPlans(plans, req, accessControl),
        req.user,
      ).map(publicPlan);
      return res.json({
        plans: scoped,
        permissions: {
          canViewFinance: canViewFinance(req, canReadCollection),
          canManage: Boolean(accessControl.isAdmin?.(req.user) || accessControl.isOfficeManager?.(req.user)),
        },
      });
    } catch (error) {
      return accessError(res, error);
    }
  });

  router.get('/clients/:id/debt-collection-plan', requireAuth, requireRead(COLLECTION), (req, res) => {
    try {
      accessControl.assertCanReadCollection(COLLECTION, req.user);
      const plans = Array.isArray(readData(COLLECTION)) ? readData(COLLECTION) : [];
      const scoped = filterPlans(plans, req, accessControl);
      const plan = scoped.find(item => normalizeText(item?.clientId) === normalizeText(req.params.id));
      if (!plan) return res.json({ plan: null });
      return res.json({ plan: publicPlan(accessControl.sanitizeEntityForRead(COLLECTION, plan, req.user)) });
    } catch (error) {
      return accessError(res, error);
    }
  });

  router.post('/debt-collection-plans', requireAuth, requireWrite(COLLECTION), (req, res) => {
    try {
      accessControl.assertCanCreateCollection(COLLECTION, req.user, req.body);
      const plans = Array.isArray(readData(COLLECTION)) ? readData(COLLECTION) : [];
      const next = normalizePlan(req.body, { req, readData, generateId, idPrefix, nowIso });
      plans.push(next);
      writeData(COLLECTION, plans);
      auditPlanChange(auditLog, req, `${COLLECTION}.create`, null, next);
      return res.status(201).json(publicPlan(next));
    } catch (error) {
      return accessError(res, error);
    }
  });

  router.patch('/debt-collection-plans/:id', requireAuth, requireWrite(COLLECTION), (req, res) => {
    try {
      const plans = Array.isArray(readData(COLLECTION)) ? readData(COLLECTION) : [];
      const index = plans.findIndex(item => normalizeText(item?.id) === normalizeText(req.params.id));
      if (index < 0) return res.status(404).json({ ok: false, error: 'План взыскания не найден' });
      const previous = plans[index];
      accessControl.assertCanUpdateEntity(COLLECTION, previous, req.user);
      const next = normalizePlan(req.body, { previous, req, readData, generateId, idPrefix, nowIso });
      plans[index] = next;
      writeData(COLLECTION, plans);
      auditPlanChange(auditLog, req, `${COLLECTION}.update`, previous, next);
      if (previous.status !== next.status) {
        auditPlanChange(
          auditLog,
          req,
          next.status === 'closed' ? `${COLLECTION}.close` : `${COLLECTION}.status_change`,
          previous,
          next,
        );
      }
      if (normalizeText(previous.comment) !== normalizeText(next.comment)) {
        auditPlanChange(auditLog, req, `${COLLECTION}.comment`, previous, next);
      }
      return res.json(publicPlan(next));
    } catch (error) {
      return accessError(res, error);
    }
  });

  return router;
}

module.exports = {
  ACTION_TYPES,
  COLLECTION,
  PRIORITIES,
  STATUSES,
  registerDebtCollectionPlanRoutes,
};
