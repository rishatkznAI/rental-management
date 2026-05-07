const {
  buildPlannerRows,
  readPlannerCollections,
  readScopedPlannerCollections,
  resolvePlannerRowSource,
  splitPlannerRowId,
} = require('../lib/planner-core');

function requirePlannerDeps(deps) {
  const required = [
    'readData',
    'writeData',
    'requireAuth',
    'requireRead',
    'requireWrite',
    'accessControl',
    'generateId',
    'nowIso',
  ];
  for (const key of required) {
    if (!deps?.[key]) throw new Error(`Planner routes require dependency: ${key}`);
  }
  if (typeof deps.accessControl.filterCollectionByScope !== 'function') {
    throw new Error('Planner routes require access-control method: filterCollectionByScope');
  }
  if (typeof deps.accessControl.canMutateEntity !== 'function') {
    throw new Error('Planner routes require access-control method: canMutateEntity');
  }
}

function registerPlannerRoutes(apiRouter, deps) {
  requirePlannerDeps(deps);

  const {
    readData,
    writeData,
    requireAuth,
    requireRead,
    requireWrite,
    accessControl,
    generateId,
    nowIso,
  } = deps;

  apiRouter.get('/planner', requireAuth, requireRead('planner_items'), (req, res) => {
    try {
      const includeShipped = req.query.include_shipped === '1';
      const collections = readScopedPlannerCollections({ readData, accessControl, user: req.user });
      const rows = buildPlannerRows(collections, { includeShipped });
      res.json(rows);
    } catch (err) {
      console.error('[PLANNER] GET /api/planner error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  apiRouter.put('/planner/:rowId', requireAuth, requireWrite('planner_items'), (req, res) => {
    try {
      const { rowId } = req.params;
      const parsed = splitPlannerRowId(rowId);
      if (!parsed) {
        return res.status(400).json({ ok: false, error: 'Неверный формат rowId' });
      }

      const collections = readPlannerCollections({ readData });
      const source = resolvePlannerRowSource(rowId, collections);
      if (!source) {
        return res.status(404).json({ ok: false, error: 'Строка планировщика не найдена' });
      }
      if (!accessControl.canMutateEntity(source.collection, source.entity, req.user)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }

      const items = readData('planner_items') || [];
      const existingIdx = items.findIndex(p => p.rentalId === parsed.sourceId && p.equipmentRef === parsed.equipmentRef);

      const updatedFields = {};
      if (req.body.prepStatus !== undefined) updatedFields.prepStatus = req.body.prepStatus;
      if (req.body.priorityOverride !== undefined) updatedFields.priorityOverride = req.body.priorityOverride;
      if (req.body.riskOverride !== undefined) updatedFields.riskOverride = req.body.riskOverride;
      if (req.body.comment !== undefined) updatedFields.comment = req.body.comment;

      let item;
      if (existingIdx >= 0) {
        items[existingIdx] = {
          ...items[existingIdx],
          ...updatedFields,
          updatedAt: nowIso(),
          updatedBy: req.user.userName,
        };
        item = items[existingIdx];
      } else {
        item = {
          id: generateId('PI'),
          rentalId: parsed.sourceId,
          equipmentRef: parsed.equipmentRef,
          prepStatus: updatedFields.prepStatus || 'planned',
          priorityOverride: updatedFields.priorityOverride ?? null,
          riskOverride: updatedFields.riskOverride ?? null,
          comment: updatedFields.comment || '',
          updatedAt: nowIso(),
          updatedBy: req.user.userName,
        };
        items.push(item);
      }

      writeData('planner_items', items);
      res.json(item);
    } catch (err) {
      console.error('[PLANNER] PUT /api/planner/:rowId error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

module.exports = {
  registerPlannerRoutes,
};
