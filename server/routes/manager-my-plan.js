const express = require('express');
const {
  activityMatchesPeriod,
  buildAccess,
  buildActivityAggregates,
  buildManagerMyPlan,
  chooseManagerScope,
  dateKey,
  isPlanRoleAllowed,
  safeActivity,
  text,
} = require('../lib/manager-my-plan');

const ACTIVITY_TYPES = new Set(['call', 'site_visit', 'note']);
const ACTIVITY_RESULTS = new Set(['completed', 'no_answer', 'scheduled', 'info', 'other']);

function registerManagerMyPlanRoutes(deps) {
  const {
    readData,
    writeData,
    requireAuth,
    getRoleAccessSummary,
    todayKey,
    nowIso = () => new Date().toISOString(),
    generateId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  } = deps;

  const router = express.Router();

  function commonContext(req) {
    const access = buildAccess(req.user?.userRole, getRoleAccessSummary);
    if (!isPlanRoleAllowed(access)) return { access, forbidden: true };
    const users = readData('users') || [];
    return {
      access,
      manager: chooseManagerScope(req, users, access),
    };
  }

  function activityContext(req) {
    const context = commonContext(req);
    if (context.forbidden) return context;
    const clients = readData('clients') || [];
    const rentals = [...(readData('rentals') || []), ...(readData('gantt_rentals') || [])];
    const equipment = readData('equipment') || [];
    return {
      ...context,
      activityRows: readData('manager_activity') || [],
      clientsById: new Map(clients.map(item => [text(item.id), item])),
      rentalsById: new Map(rentals.map(item => [text(item.id), item])),
      equipmentById: new Map(equipment.map(item => [text(item.id), item])),
    };
  }

  router.get('/manager/my-plan', requireAuth, (req, res) => {
    const result = buildManagerMyPlan({
      req,
      readData,
      getRoleAccessSummary,
      todayKey,
    });
    return res.status(result.status).json(result.body);
  });

  router.get('/manager/my-plan/activity', requireAuth, (req, res) => {
    const context = activityContext(req);
    if (context.forbidden) return res.status(403).json({ ok: false, error: 'Forbidden' });
    if (!['Менеджер по аренде', 'Администратор'].includes(context.access.normalizedRole)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    const today = todayKey || dateKey(nowIso());
    const from = dateKey(req.query?.from);
    const to = dateKey(req.query?.to);
    const scoped = context.activityRows
      .filter(item => activityMatchesPeriod(item, from, to))
      .filter(item => {
        const safe = safeActivity(item);
        if (context.access.normalizedRole === 'Администратор' && !context.manager.id) return true;
        return safe.managerId === context.manager.id || safe.userId === context.manager.id;
      })
      .map(item => safeActivity(item, context.clientsById, context.rentalsById, context.equipmentById))
      .sort((a, b) => text(b.effectiveAt || b.createdAt).localeCompare(text(a.effectiveAt || a.createdAt)));
    const aggregates = buildActivityAggregates({
      activityRows: context.activityRows,
      manager: context.manager,
      todayKey: today,
      dailyCallsTarget: 40,
      weeklySiteVisitsTarget: 2,
      required: true,
      clientsById: context.clientsById,
      rentalsById: context.rentalsById,
      equipmentById: context.equipmentById,
    });
    return res.json({
      ok: true,
      items: scoped.slice(0, 100),
      aggregates,
    });
  });

  router.post('/manager/my-plan/activity', requireAuth, (req, res) => {
    const context = commonContext(req);
    if (context.forbidden) return res.status(403).json({ ok: false, error: 'Forbidden' });
    if (!['Менеджер по аренде', 'Администратор'].includes(context.access.normalizedRole)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (typeof writeData !== 'function') return res.status(503).json({ ok: false, error: 'Activity write storage is unavailable' });

    const now = nowIso();
    const activityType = ACTIVITY_TYPES.has(req.body?.activityType) ? req.body.activityType : '';
    if (!activityType) return res.status(400).json({ ok: false, error: 'Unsupported activity type' });
    const resultStatus = ACTIVITY_RESULTS.has(req.body?.resultStatus) ? req.body.resultStatus : 'other';
    const effectiveAt = req.body?.effectiveAt || req.body?.activityDate || now;
    const item = {
      id: text(req.body?.id) || generateId('mact'),
      createdAt: now,
      createdBy: text(req.user?.userId),
      userId: text(req.user?.userId),
      managerId: text(req.user?.userId),
      managerName: text(req.user?.userName),
      activityType,
      relatedClientId: text(req.body?.relatedClientId),
      relatedRentalId: text(req.body?.relatedRentalId),
      relatedEquipmentId: text(req.body?.relatedEquipmentId),
      resultStatus,
      comment: text(req.body?.comment).slice(0, 1000),
      activityDate: dateKey(effectiveAt || now) || dateKey(now),
      effectiveAt: new Date(effectiveAt).toString() === 'Invalid Date' ? now : new Date(effectiveAt).toISOString(),
    };
    const rows = readData('manager_activity') || [];
    writeData('manager_activity', [...rows, item]);
    return res.status(201).json({ ok: true, item: safeActivity(item) });
  });

  return router;
}

module.exports = {
  registerManagerMyPlanRoutes,
};
