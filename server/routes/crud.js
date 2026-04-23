const express = require('express');
const { syncGanttRentalPaymentStatuses } = require('../lib/payment-status-sync');

function registerCrudRoutes(deps) {
  const {
    collections,
    idPrefixes,
    readData,
    writeData,
    requireAuth,
    requireWrite,
    sanitizeUser,
    publicUserView,
    canReadFullUsers,
    normalizeServiceWorkRecord,
    normalizeSparePartRecord,
    validateRentalPayload,
    mergeEntityHistory,
    requireNonEmptyString,
    generateId,
    nowIso,
    applyServiceTicketCreationEffects,
  } = deps;

  const router = express.Router();

  function syncPaymentStatusesAfterPaymentWrite(payments) {
    const currentGanttRentals = readData('gantt_rentals') || [];
    const nextGanttRentals = syncGanttRentalPaymentStatuses(currentGanttRentals, payments);
    writeData('gantt_rentals', nextGanttRentals);
  }

  function officeManagerCanOnlyCreateRental(req, collection, method) {
    const isRentalCollection = collection === 'rentals' || collection === 'gantt_rentals';
    if (!isRentalCollection) return false;
    if (req.user?.userRole !== 'Офис-менеджер') return false;
    return method !== 'POST';
  }

  function rentalWriteForbiddenReason(req, collection, method) {
    const isRentalCollection = collection === 'rentals' || collection === 'gantt_rentals';
    if (!isRentalCollection) return null;

    const role = req.user?.userRole;
    if (method === 'POST') {
      if (role !== 'Администратор' && role !== 'Офис-менеджер') {
        return 'Недостаточно прав: создавать аренду могут только администратор и офис-менеджер.';
      }
      return null;
    }

    if (role !== 'Администратор') {
      return 'Недостаточно прав: изменять, удалять и восстанавливать аренду может только администратор.';
    }

    return null;
  }

  function serviceWriteForbiddenReason(req, collection, method) {
    if (collection !== 'service') return null;

    const role = req.user?.userRole;
    if (role === 'Менеджер по аренде' && method !== 'POST') {
      return 'Недостаточно прав: менеджер по аренде может только создавать сервисные заявки.';
    }

    return null;
  }

  function isKnowledgeBaseReviewer(req) {
    return req.user?.userRole === 'Администратор' || req.user?.userRole === 'Офис-менеджер';
  }

  function knowledgeBaseProgressForbiddenReason(req, collection, method, existingItem) {
    if (collection !== 'knowledge_base_progress') return null;
    if (isKnowledgeBaseReviewer(req)) return null;

    if (method === 'DELETE' || method === 'PUT') {
      return 'Недостаточно прав: массово менять или удалять прогресс обучения может только администратор или офис-менеджер.';
    }

    if (existingItem && existingItem.userId !== req.user?.userId) {
      return 'Недостаточно прав: можно менять только свой прогресс обучения.';
    }

    return null;
  }

  function knowledgeBaseModuleForbiddenReason(req, collection, method) {
    if (collection !== 'knowledge_base_modules') return null;
    if (method !== 'DELETE') return null;
    if (req.user?.userRole === 'Администратор') return null;
    return 'Недостаточно прав: удалять учебные модули может только администратор.';
  }

  function registerCRUD(collection) {
    if (collection === 'rentals' || collection === 'gantt_rentals') {
      return;
    }
    const prefix = idPrefixes[collection] || collection;

    router.get(`/${collection}`, requireAuth, (req, res) => {
      let data = readData(collection) || [];
      if (collection === 'service_works') {
        data = data
          .map(normalizeServiceWorkRecord)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
        if (req.query.active === '1') {
          data = data.filter(item => item.isActive);
        }
      }
      if (collection === 'spare_parts') {
        data = data
          .map(normalizeSparePartRecord)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        if (req.query.active === '1') {
          data = data.filter(item => item.isActive);
        }
      }
      if (collection === 'users') {
        if (canReadFullUsers(req)) {
          return res.json(data.map(sanitizeUser));
        }
        return res.json(data.filter(item => item.status === 'Активен').map(publicUserView));
      }
      if (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req)) {
        return res.json(data.filter(item => item.userId === req.user.userId));
      }
      return res.json(data);
    });

    router.get(`/${collection}/:id`, requireAuth, (req, res) => {
      const data = readData(collection) || [];
      let item = data.find(entry => entry.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
      if (collection === 'service_works') item = normalizeServiceWorkRecord(item);
      if (collection === 'spare_parts') item = normalizeSparePartRecord(item);
      if (collection === 'users') {
        if (canReadFullUsers(req) || item.id === req.user.userId) {
          return res.json(sanitizeUser(item));
        }
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      if (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req) && item.userId !== req.user.userId) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      return res.json(item);
    });

    router.post(`/${collection}`, requireAuth, requireWrite(collection), (req, res) => {
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'POST');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'POST');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'POST');
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'POST');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }
      try {
        if (collection === 'rentals' || collection === 'gantt_rentals') {
          const validation = validateRentalPayload(collection, req.body, readData(collection) || []);
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }

        if (collection === 'service_works') {
          requireNonEmptyString(req.body?.name, 'Название работы');
        }
        if (collection === 'spare_parts') {
          requireNonEmptyString(req.body?.name, 'Название запчасти');
          requireNonEmptyString(req.body?.unit, 'Единица измерения');
        }

        const data = readData(collection) || [];
        let newItem = { ...req.body, id: req.body.id || generateId(prefix) };
        if (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req)) {
          newItem = {
            ...newItem,
            userId: req.user.userId,
            userName: req.user.userName,
            userRole: req.user.userRole,
          };
        }
        if (collection === 'service_works') {
          newItem = normalizeServiceWorkRecord({ ...newItem, updatedAt: nowIso() });
        }
        if (collection === 'spare_parts') {
          newItem = normalizeSparePartRecord({ ...newItem, updatedAt: nowIso() });
        }
        if (collection === 'clients' || collection === 'equipment') {
          newItem = mergeEntityHistory(collection, null, newItem, req.user.userName);
        }
        data.push(newItem);
        writeData(collection, data);
        if (collection === 'payments') {
          syncPaymentStatusesAfterPaymentWrite(data);
        }
        if (collection === 'service') {
          applyServiceTicketCreationEffects?.(newItem, req.user.userName);
        }
        if (collection === 'users') {
          return res.status(201).json(sanitizeUser(newItem));
        }
        return res.status(201).json(newItem);
      } catch (error) {
        return res.status(400).json({ ok: false, error: error.message });
      }
    });

    router.patch(`/${collection}/:id`, requireAuth, requireWrite(collection), (req, res) => {
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'PATCH');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      if (officeManagerCanOnlyCreateRental(req, collection, 'PATCH')) {
        return res.status(403).json({ ok: false, error: 'Недостаточно прав: офис-менеджер может только создавать аренду.' });
      }
      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'PATCH', data[idx]);
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'PATCH');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }

      try {
        if (collection === 'rentals' || collection === 'gantt_rentals') {
          const validation = validateRentalPayload(
            collection,
            { ...data[idx], ...req.body },
            data,
            data[idx].id,
          );
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }

        if (collection === 'service_works') {
          requireNonEmptyString(req.body?.name ?? data[idx].name, 'Название работы');
          data[idx] = normalizeServiceWorkRecord({
            ...data[idx],
            ...req.body,
            id: data[idx].id,
            createdAt: data[idx].createdAt,
            updatedAt: nowIso(),
          });
        } else if (collection === 'spare_parts') {
          requireNonEmptyString(req.body?.name ?? data[idx].name, 'Название запчасти');
          requireNonEmptyString(req.body?.unit ?? data[idx].unit, 'Единица измерения');
          data[idx] = normalizeSparePartRecord({
            ...data[idx],
            ...req.body,
            id: data[idx].id,
            createdAt: data[idx].createdAt,
            updatedAt: nowIso(),
          });
        } else {
          const nextItem = { ...data[idx], ...req.body, id: data[idx].id };
          data[idx] = collection === 'clients' || collection === 'equipment'
            ? mergeEntityHistory(collection, data[idx], nextItem, req.user.userName)
            : (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req)
              ? {
                  ...nextItem,
                  userId: data[idx].userId,
                  userName: data[idx].userName,
                  userRole: data[idx].userRole,
                }
              : nextItem);
        }
        writeData(collection, data);
        if (collection === 'payments') {
          syncPaymentStatusesAfterPaymentWrite(data);
        }
        if (collection === 'users') {
          return res.json(sanitizeUser(data[idx]));
        }
        return res.json(data[idx]);
      } catch (error) {
        return res.status(400).json({ ok: false, error: error.message });
      }
    });

    router.delete(`/${collection}/:id`, requireAuth, requireWrite(collection), (req, res) => {
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'DELETE');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'DELETE');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'DELETE');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }
      if (officeManagerCanOnlyCreateRental(req, collection, 'DELETE')) {
        return res.status(403).json({ ok: false, error: 'Недостаточно прав: офис-менеджер может только создавать аренду.' });
      }
      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'DELETE', data[idx]);
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      if (collection === 'service') {
        const repairId = data[idx].id;
        writeData('repair_work_items', (readData('repair_work_items') || []).filter(item => item.repairId !== repairId));
        writeData('repair_part_items', (readData('repair_part_items') || []).filter(item => item.repairId !== repairId));
      }
      data.splice(idx, 1);
      writeData(collection, data);
      if (collection === 'payments') {
        syncPaymentStatusesAfterPaymentWrite(data);
      }
      return res.json({ ok: true });
    });

    router.put(`/${collection}`, requireAuth, requireWrite(collection), (req, res) => {
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'PUT');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'PUT');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      if (officeManagerCanOnlyCreateRental(req, collection, 'PUT')) {
        return res.status(403).json({ ok: false, error: 'Недостаточно прав: офис-менеджер может только создавать аренду.' });
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'PUT');
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'PUT');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }
      const body = req.body;
      const list = Array.isArray(body) ? body : body.data;
      if (!Array.isArray(list)) {
        return res.status(400).json({ ok: false, error: 'Expected array' });
      }

      if (collection === 'rentals' || collection === 'gantt_rentals') {
        for (const item of list) {
          const validation = validateRentalPayload(collection, item, list, item.id);
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }
      }

      if (collection === 'service_works') {
        writeData(collection, list.map(item => normalizeServiceWorkRecord({ ...item, updatedAt: nowIso() })));
        return res.json({ ok: true, count: list.length });
      }

      if (collection === 'spare_parts') {
        writeData(collection, list.map(item => normalizeSparePartRecord({ ...item, updatedAt: nowIso() })));
        return res.json({ ok: true, count: list.length });
      }

      if (collection === 'users') {
        const existing = readData('users') || [];
        const existingById = new Map(existing.map(item => [item.id, item]));
        const merged = list.map(item => {
          if (!item.password) {
            const existingPwd = existingById.get(item.id)?.password;
            if (existingPwd) return { ...item, password: existingPwd };
          }
          return item;
        });
        writeData('users', merged);
        return res.json({ ok: true, count: merged.length });
      }

      writeData(collection, list);
      if (collection === 'payments') {
        syncPaymentStatusesAfterPaymentWrite(list);
      }
      return res.json({ ok: true, count: list.length });
    });
  }

  for (const collection of collections) {
    registerCRUD(collection);
  }

  return router;
}

module.exports = {
  registerCrudRoutes,
};
