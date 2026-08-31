const express = require('express');
const {
  assertCanonicalArWorkflowWrite,
  decorateArWorkflowRecord,
  resolveArWorkflowIdentity,
} = require('../lib/ar-debtor-workflow');
const { AUDIT_COLLECTION, createAuditEntry } = require('../lib/security-audit');

const COLLECTION = 'debt_collection_plans';

const STATUSES = new Set(['new', 'contacted', 'promised', 'partial_paid', 'disputed', 'escalation', 'legal', 'closed']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const ACTION_TYPES = new Set(['call', 'message', 'email', 'documents', 'restrict_equipment', 'claim', 'meeting', 'wait_payment', 'other']);

const SAFE_PLAN_FIELDS = [
  'counterpartyId',
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

function findClient(readData, clientId) {
  const clients = Array.isArray(readData('clients')) ? readData('clients') : [];
  const id = normalizeText(clientId);
  if (!id) return null;
  return clients.find(client => normalizeText(client?.id) === id) || null;
}

function normalizePlan(input, { previous = null, req, readData, generateId, idPrefix, nowIso }) {
  const safe = pickSafePlanFields(input);
  const now = nowIso();
  const client = findClient(readData, safe.clientId ?? previous?.clientId);
  const clientId = normalizeText(safe.clientId ?? previous?.clientId ?? client?.id);
  const counterpartyId = normalizeText(safe.counterpartyId ?? previous?.counterpartyId ?? client?.counterpartyId);
  const clientName = normalizeText(client?.company ?? safe.clientName ?? previous?.clientName);

  if (!counterpartyId && !clientId) {
    const error = new Error('Укажите canonical Counterparty или стабильный Client для плана взыскания.');
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

  const normalized = {
    ...(previous || {}),
    id: previous?.id || normalizeText(input?.id) || generateId(idPrefix),
    counterpartyId: counterpartyId || undefined,
    clientId: clientId || undefined,
    clientName: clientName || previous?.clientName || 'Контрагент не указан',
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
  return assertCanonicalArWorkflowWrite(COLLECTION, normalized, { readData }, {
    recordId: normalized.id,
  });
}

function accessError(res, error) {
  return res.status(error?.status || 403).json({
    ok: false,
    error: error?.message || 'Forbidden',
    ...(error?.code ? { code: error.code } : {}),
    ...(error?.details ? { details: error.details } : {}),
  });
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

function planAuditEntry(req, action, previous, next, metadata, { generateId, nowIso }) {
  return createAuditEntry(req, {
    action,
    entityType: COLLECTION,
    entityId: next?.id || previous?.id,
    before: previous ? pickSafePlanFields(previous) : null,
    after: next ? pickSafePlanFields(next) : null,
    metadata,
  }, { generateId, nowIso });
}

function publicPlan(plan, readData) {
  const decorated = decorateArWorkflowRecord(COLLECTION, plan, { readData }, {
    domain: COLLECTION,
    recordId: plan?.id,
  });
  return {
    id: decorated?.id,
    ...pickSafePlanFields(decorated),
    debtorCounterpartyId: decorated.debtorCounterpartyId,
    debtorIdentityStatus: decorated.debtorIdentityStatus,
    debtorIdentityIssues: decorated.debtorIdentityIssues,
  };
}

function registerDebtCollectionPlanRoutes(deps) {
  const {
    readData,
    writeAuditDataBatch,
    requireAuth,
    requireRead,
    requireWrite,
    canReadCollection,
    accessControl,
    generateId,
    idPrefixes = {},
    nowIso = () => new Date().toISOString(),
  } = deps;

  const router = express.Router();
  const idPrefix = idPrefixes[COLLECTION] || 'DCP';

  function persistPlansWithAudit(req, plans, events) {
    if (typeof writeAuditDataBatch !== 'function') {
      const error = new Error('Atomic debt-plan audit persistence is unavailable.');
      error.status = 500;
      throw error;
    }
    const currentAudit = Array.isArray(readData(AUDIT_COLLECTION)) ? readData(AUDIT_COLLECTION) : null;
    if (!currentAudit) {
      const error = new Error('Stored audit history is malformed; refusing to overwrite it.');
      error.code = 'AUDIT_HISTORY_SHAPE_INVALID';
      error.status = 409;
      throw error;
    }
    const auditEntries = events.map(event => planAuditEntry(
      req,
      event.action,
      event.previous,
      event.next,
      event.metadata || null,
      { generateId, nowIso },
    ));
    writeAuditDataBatch([
      { name: COLLECTION, value: plans },
      { name: AUDIT_COLLECTION, value: [...currentAudit, ...auditEntries] },
    ]);
  }

  router.get('/debt-collection-plans', requireAuth, requireRead(COLLECTION), (req, res) => {
    try {
      accessControl.assertCanReadCollection(COLLECTION, req.user);
      const plans = Array.isArray(readData(COLLECTION)) ? [...readData(COLLECTION)] : [];
      const scoped = accessControl.sanitizeCollectionForRead(
        COLLECTION,
        filterPlans(plans, req, accessControl),
        req.user,
      ).map(plan => publicPlan(plan, readData));
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
      const plans = Array.isArray(readData(COLLECTION)) ? [...readData(COLLECTION)] : [];
      const scoped = filterPlans(plans, req, accessControl);
      const requestedIdentity = resolveArWorkflowIdentity(COLLECTION, {
        clientId: normalizeText(req.params.id),
      }, { readData }, {
        domain: 'client_receivable_selection',
        recordId: normalizeText(req.params.id),
      });
      const plan = requestedIdentity.counterpartyId
        ? scoped.find(item => (
            resolveArWorkflowIdentity(COLLECTION, item, { readData }, {
              domain: COLLECTION,
              recordId: item?.id,
            }).counterpartyId === requestedIdentity.counterpartyId
          ))
        : null;
      if (!plan) {
        return res.json({
          plan: null,
          debtorCounterpartyId: requestedIdentity.counterpartyId,
          debtorIdentityStatus: requestedIdentity.status,
        });
      }
      return res.json({ plan: publicPlan(accessControl.sanitizeEntityForRead(COLLECTION, plan, req.user), readData) });
    } catch (error) {
      return accessError(res, error);
    }
  });

  router.post('/debt-collection-plans', requireAuth, requireWrite(COLLECTION), (req, res) => {
    try {
      accessControl.assertCanCreateCollection(COLLECTION, req.user, req.body);
      const plans = Array.isArray(readData(COLLECTION)) ? [...readData(COLLECTION)] : [];
      const next = normalizePlan(req.body, { req, readData, generateId, idPrefix, nowIso });
      plans.push(next);
      persistPlansWithAudit(req, plans, [
        { action: `${COLLECTION}.create`, previous: null, next },
      ]);
      return res.status(201).json(publicPlan(next, readData));
    } catch (error) {
      return accessError(res, error);
    }
  });

  router.patch('/debt-collection-plans/:id', requireAuth, requireWrite(COLLECTION), (req, res) => {
    try {
      const plans = Array.isArray(readData(COLLECTION)) ? [...readData(COLLECTION)] : [];
      const index = plans.findIndex(item => normalizeText(item?.id) === normalizeText(req.params.id));
      if (index < 0) return res.status(404).json({ ok: false, error: 'План взыскания не найден' });
      const previous = plans[index];
      accessControl.assertCanUpdateEntity(COLLECTION, previous, req.user);
      const next = normalizePlan(req.body, { previous, req, readData, generateId, idPrefix, nowIso });
      plans[index] = next;
      const auditEvents = [{ action: `${COLLECTION}.update`, previous, next }];
      if (previous.status !== next.status) {
        auditEvents.push({
          action: next.status === 'closed' ? `${COLLECTION}.close` : `${COLLECTION}.status_change`,
          previous,
          next,
        });
      }
      if (normalizeText(previous.comment) !== normalizeText(next.comment)) {
        auditEvents.push({ action: `${COLLECTION}.comment`, previous, next });
      }
      persistPlansWithAudit(req, plans, auditEvents);
      return res.json(publicPlan(next, readData));
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
