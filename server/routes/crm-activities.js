const express = require('express');
const {
  buildLookups,
  buildManagerKpi,
  canAccessRelatedEntity,
  canSeeAllCrmActivities,
  canUseCrmActivities,
  filterActivities,
  normalizeActivity,
  safeActivity,
  text,
} = require('../lib/crm-activities');

function registerCrmActivityRoutes(deps) {
  const {
    readData,
    writeData,
    requireAuth,
    generateId = prefix => `${prefix}-${Date.now()}`,
    nowIso = () => new Date().toISOString(),
  } = deps;

  const router = express.Router();

  function forbidden(res) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  function visibleRows(req, lookups) {
    const rows = readData('crm_activities') || [];
    const scoped = canSeeAllCrmActivities(req.user)
      ? rows
      : rows.filter(item => text(item.managerId) === text(req.user?.userId) || text(item.createdBy) === text(req.user?.userId));
    return filterActivities(scoped, req.query).map(item => safeActivity(item, lookups));
  }

  router.get('/crm/activities', requireAuth, (req, res) => {
    if (!canUseCrmActivities(req.user)) return forbidden(res);
    const lookups = buildLookups(readData);
    const items = visibleRows(req, lookups)
      .sort((a, b) => text(b.occurredAt || b.createdAt).localeCompare(text(a.occurredAt || a.createdAt)));
    return res.json({ ok: true, items });
  });

  router.post('/crm/activities', requireAuth, (req, res) => {
    if (!canUseCrmActivities(req.user)) return forbidden(res);
    if (typeof writeData !== 'function') return res.status(503).json({ ok: false, error: 'CRM activity storage is unavailable' });
    const lookups = buildLookups(readData);
    if (!canAccessRelatedEntity(req.body, req.user, lookups)) {
      return res.status(403).json({ ok: false, error: 'Связанная сущность недоступна' });
    }
    try {
      const item = normalizeActivity(req.body, { user: req.user, nowIso, generateId, lookups });
      const rows = readData('crm_activities') || [];
      writeData('crm_activities', [...rows, item]);
      return res.status(201).json({ ok: true, item: safeActivity(item, lookups) });
    } catch (error) {
      return res.status(error.status || 400).json({ ok: false, error: error.message || 'Invalid CRM activity' });
    }
  });

  router.patch('/crm/activities/:id', requireAuth, (req, res) => {
    if (!canUseCrmActivities(req.user)) return forbidden(res);
    const rows = readData('crm_activities') || [];
    const index = rows.findIndex(item => text(item.id) === text(req.params.id));
    if (index === -1 || rows[index]?.deletedAt) return res.status(404).json({ ok: false, error: 'CRM activity not found' });
    if (!canSeeAllCrmActivities(req.user) && text(rows[index].managerId) !== text(req.user?.userId)) return forbidden(res);

    const lookups = buildLookups(readData);
    const candidate = { ...rows[index], ...req.body };
    if (!canAccessRelatedEntity(candidate, req.user, lookups)) {
      return res.status(403).json({ ok: false, error: 'Связанная сущность недоступна' });
    }
    try {
      const next = normalizeActivity(candidate, { existing: rows[index], user: req.user, nowIso, generateId, lookups });
      const updated = rows.slice();
      updated[index] = next;
      writeData('crm_activities', updated);
      return res.json({ ok: true, item: safeActivity(next, lookups) });
    } catch (error) {
      return res.status(error.status || 400).json({ ok: false, error: error.message || 'Invalid CRM activity' });
    }
  });

  router.delete('/crm/activities/:id', requireAuth, (req, res) => {
    if (!canUseCrmActivities(req.user)) return forbidden(res);
    const rows = readData('crm_activities') || [];
    const index = rows.findIndex(item => text(item.id) === text(req.params.id));
    if (index === -1 || rows[index]?.deletedAt) return res.status(404).json({ ok: false, error: 'CRM activity not found' });
    if (!canSeeAllCrmActivities(req.user) && text(rows[index].managerId) !== text(req.user?.userId)) return forbidden(res);
    const updated = rows.slice();
    updated[index] = {
      ...rows[index],
      deletedAt: nowIso(),
      deletedBy: text(req.user?.userId),
      updatedAt: nowIso(),
    };
    writeData('crm_activities', updated);
    return res.json({ ok: true });
  });

  router.get('/crm/manager-kpi', requireAuth, (req, res) => {
    if (!canUseCrmActivities(req.user)) return forbidden(res);
    const allActivities = readData('crm_activities') || [];
    const scopedActivities = canSeeAllCrmActivities(req.user)
      ? allActivities
      : allActivities.filter(item => text(item.managerId) === text(req.user?.userId) || text(item.createdBy) === text(req.user?.userId));
    const query = {
      ...req.query,
      managerId: canSeeAllCrmActivities(req.user) ? req.query.managerId : req.user?.userId,
    };
    const body = buildManagerKpi({
      activities: scopedActivities,
      deals: readData('crm_deals') || [],
      rentals: [...(readData('rentals') || []), ...(readData('gantt_rentals') || [])],
      managers: readData('users') || [],
      query,
      readData,
    });
    return res.json({ ok: true, ...body });
  });

  return router;
}

module.exports = {
  registerCrmActivityRoutes,
};
