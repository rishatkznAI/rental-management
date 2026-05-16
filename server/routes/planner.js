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

const DEFAULT_PLANNER_PAST_DAYS = 7;
const DEFAULT_PLANNER_FUTURE_DAYS = 45;
const MAX_PLANNER_WINDOW_DAYS = 180;

function dateKey(value) {
  if (!value) return '';
  const raw = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function addDaysKey(base, days) {
  const [year, month, day] = String(base).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const [fromYear, fromMonth, fromDay] = String(from).split('-').map(Number);
  const [toYear, toMonth, toDay] = String(to).split('-').map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000);
}

function resolvePlannerDateWindow(query, today = new Date().toISOString().slice(0, 10)) {
  const requestedFrom = dateKey(query.dateFrom);
  const requestedTo = dateKey(query.dateTo);
  const dateFrom = requestedFrom || addDaysKey(today, -DEFAULT_PLANNER_PAST_DAYS);
  const dateTo = requestedTo || addDaysKey(today, DEFAULT_PLANNER_FUTURE_DAYS);
  if (!dateFrom || !dateTo || dateFrom > dateTo) {
    return { ok: false, status: 400, error: 'Некорректный период планировщика.' };
  }
  const span = daysBetween(dateFrom, dateTo);
  if (span > MAX_PLANNER_WINDOW_DAYS) {
    return {
      ok: false,
      status: 400,
      error: `Период планировщика не может превышать ${MAX_PLANNER_WINDOW_DAYS} дней.`,
    };
  }
  return { ok: true, dateFrom, dateTo };
}

function rowInPlannerWindow(row, dateFrom, dateTo) {
  const startDate = dateKey(row?.startDate);
  return Boolean(startDate && startDate >= dateFrom && startDate <= dateTo);
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
      const window = resolvePlannerDateWindow(req.query);
      if (!window.ok) return res.status(window.status).json({ ok: false, error: window.error });
      const collections = readScopedPlannerCollections({ readData, accessControl, user: req.user });
      const rows = buildPlannerRows(collections, { includeShipped })
        .filter(row => rowInPlannerWindow(row, window.dateFrom, window.dateTo));
      res.json({
        items: rows,
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
        total: rows.length,
      });
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
  resolvePlannerDateWindow,
};
