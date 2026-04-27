const express = require('express');
const {
  appendRentalHistory,
  buildRentalChangeRequest,
  buildRentalImmediateHistoryEntries,
  displayValue,
  getFieldLabel,
  splitRentalPatch,
  stripRentalPatchMeta,
  syncGanttRentalFields,
} = require('../lib/rental-change-requests');

function registerRentalRoutes(deps) {
  const {
    readData,
    writeData,
    requireAuth,
    requireRead,
    validateRentalPayload,
    mergeRentalHistory,
    normalizeGanttRentalList,
    normalizeGanttRentalStatus,
    generateId,
    idPrefixes,
  } = deps;

  const router = express.Router();

  function rentalWriteForbiddenReason(req, collection, method) {
    const role = req.user?.userRole;
    if (method === 'POST') {
      if (role !== 'Администратор' && role !== 'Офис-менеджер') {
        return 'Недостаточно прав: создавать аренду могут только администратор и офис-менеджер.';
      }
      return null;
    }

    if (method === 'PATCH' && collection === 'rentals') {
      if (role === 'Администратор' || role === 'Офис-менеджер' || role === 'Менеджер по аренде') {
        return null;
      }
      return 'Недостаточно прав: редактировать карточку аренды могут администратор, офис-менеджер и менеджер по аренде.';
    }

    if (role !== 'Администратор') {
      return 'Недостаточно прав: изменять, удалять и восстанавливать аренду может только администратор.';
    }

    return null;
  }

  function registerRentalCollection(collection) {
    const prefix = idPrefixes[collection] || collection;
    const requestPrefix = idPrefixes.rental_change_requests || 'RCR';

    function buildLinkedGanttRentalUpdate(linkedGanttRentalId, previousRental, nextRental, author) {
      if (!linkedGanttRentalId) return null;
      const ganttRentals = readData('gantt_rentals') || [];
      const ganttIdx = ganttRentals.findIndex(entry => entry.id === linkedGanttRentalId);
      if (ganttIdx === -1) return null;
      return {
        ganttRentals,
        ganttIdx,
        nextGanttRental: syncGanttRentalFields(ganttRentals[ganttIdx], previousRental, nextRental, author),
      };
    }

    function validateLinkedGanttRental(linkedGanttRentalId, previousRental, nextRental, author) {
      const update = buildLinkedGanttRentalUpdate(linkedGanttRentalId, previousRental, nextRental, author);
      if (!update) return { ok: true };
      return validateRentalPayload(
        'gantt_rentals',
        update.nextGanttRental,
        update.ganttRentals,
        readData('equipment') || [],
        update.nextGanttRental.id,
      );
    }

    function syncLinkedGanttRental(linkedGanttRentalId, previousRental, nextRental, author) {
      const update = buildLinkedGanttRentalUpdate(linkedGanttRentalId, previousRental, nextRental, author);
      if (!update) return;
      const { ganttRentals, ganttIdx, nextGanttRental } = update;
      ganttRentals[ganttIdx] = nextGanttRental;
      writeData('gantt_rentals', ganttRentals);
    }

    function createApprovalRequests(previousRental, changes, meta, req) {
      if (!changes.length) return [];
      const requests = readData('rental_change_requests') || [];
      const created = changes.map(change => buildRentalChangeRequest({
        id: generateId(requestPrefix),
        rental: previousRental,
        linkedGanttRentalId: meta.linkedGanttRentalId,
        change,
        initiator: req.user,
        reason: meta.reason,
        comment: meta.comment,
        attachments: meta.attachments,
      }));
      writeData('rental_change_requests', [...requests, ...created]);
      return created;
    }

    function validateImmediateRentalPatch(previousRental, patch, data, approvalChanges, meta, author) {
      if (Object.keys(patch).length === 0) {
        return { ok: true, patch, nextItem: previousRental };
      }

      let nextPatch = { ...patch };
      let nextItem = { ...previousRental, ...nextPatch, id: previousRental.id };
      let validation = validateRentalPayload(collection, nextItem, data, readData('equipment') || [], previousRental.id);
      if (validation.ok) {
        validation = validateLinkedGanttRental(meta.linkedGanttRentalId, previousRental, nextItem, author);
      }

      if (!validation.ok && validation.status === 409 && Object.prototype.hasOwnProperty.call(nextPatch, 'plannedReturnDate')) {
        approvalChanges.push({
          field: 'plannedReturnDate',
          label: getFieldLabel('plannedReturnDate'),
          oldValue: previousRental.plannedReturnDate,
          newValue: nextPatch.plannedReturnDate,
          type: 'Продление аренды с конфликтом',
          reason: validation.error || 'Продление конфликтует с будущей арендой и требует решения администратора.',
        });
        delete nextPatch.plannedReturnDate;
        nextItem = { ...previousRental, ...nextPatch, id: previousRental.id };
        if (Object.keys(nextPatch).length > 0) {
          validation = validateRentalPayload(collection, nextItem, data, readData('equipment') || [], previousRental.id);
          if (validation.ok) {
            validation = validateLinkedGanttRental(meta.linkedGanttRentalId, previousRental, nextItem, author);
          }
        } else {
          validation = { ok: true };
        }
      }

      if (!validation.ok) return validation;
      return { ok: true, patch: nextPatch, nextItem };
    }

    router.get(`/${collection}`, requireAuth, requireRead(collection), (req, res) => {
      return res.json(readData(collection) || []);
    });

    router.get(`/${collection}/:id`, requireAuth, requireRead(collection), (req, res) => {
      const data = readData(collection) || [];
      const item = data.find(entry => entry.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
      return res.json(item);
    });

    router.post(`/${collection}`, requireAuth, (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'POST');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const data = readData(collection) || [];
      const equipment = readData('equipment') || [];
      const validation = validateRentalPayload(collection, req.body, data, equipment);
      if (!validation.ok) {
        return res.status(validation.status).json({ ok: false, error: validation.error });
      }

      let newItem = { ...req.body, id: req.body.id || generateId(prefix) };
      if (collection === 'gantt_rentals') {
        newItem = normalizeGanttRentalStatus(newItem);
        newItem = mergeRentalHistory(null, newItem, req.user.userName);
      }
      data.push(newItem);
      writeData(collection, data);
      return res.status(201).json(newItem);
    });

    router.patch(`/${collection}/:id`, requireAuth, (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const { patch, meta } = stripRentalPatchMeta(req.body);
      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });

      if (collection === 'rentals' && req.user?.userRole !== 'Администратор') {
        const previousRental = data[idx];
        const { immediatePatch, approvalChanges } = splitRentalPatch({
          previousRental,
          patch,
          payments: readData('payments') || [],
        });

        const immediateValidation = validateImmediateRentalPatch(previousRental, immediatePatch, data, approvalChanges, meta, req.user.userName);
        if (!immediateValidation.ok) {
          return res.status(immediateValidation.status).json({ ok: false, error: immediateValidation.error });
        }

        const createdRequests = createApprovalRequests(previousRental, approvalChanges, meta, req);
        let nextItem = immediateValidation.nextItem;
        const appliedFields = Object.keys(immediateValidation.patch || {});
        if (appliedFields.length > 0) {
          nextItem = appendRentalHistory(
            nextItem,
            buildRentalImmediateHistoryEntries(previousRental, nextItem, req.user.userName),
          );
          data[idx] = nextItem;
          writeData(collection, data);
          syncLinkedGanttRental(meta.linkedGanttRentalId, previousRental, nextItem, req.user.userName);
        } else if (createdRequests.length > 0) {
          writeData(collection, data);
        }

        return res.json({
          ...data[idx],
          changeRequestSummary: {
            appliedFields,
            pendingCount: createdRequests.length,
            pendingRequestIds: createdRequests.map(item => item.id),
            pendingDescriptions: createdRequests.map(item => `${item.fieldLabel}: ${displayValue(item.oldValue)} → ${displayValue(item.newValue)}`),
          },
        });
      }

      let nextItem = { ...data[idx], ...patch, id: data[idx].id };
      if (collection === 'gantt_rentals') {
        nextItem = normalizeGanttRentalStatus(nextItem);
      }
      const validation = validateRentalPayload(collection, nextItem, data, readData('equipment') || [], data[idx].id);
      if (!validation.ok) {
        return res.status(validation.status).json({ ok: false, error: validation.error });
      }
      if (collection === 'rentals') {
        const linkedValidation = validateLinkedGanttRental(meta.linkedGanttRentalId, data[idx], nextItem, req.user.userName);
        if (!linkedValidation.ok) {
          return res.status(linkedValidation.status).json({ ok: false, error: linkedValidation.error });
        }
      }

      if (collection === 'gantt_rentals') {
        nextItem = mergeRentalHistory(data[idx], nextItem, req.user.userName);
      } else if (collection === 'rentals') {
        nextItem = appendRentalHistory(
          nextItem,
          buildRentalImmediateHistoryEntries(data[idx], nextItem, req.user.userName),
        );
      }
      const previousRental = data[idx];
      data[idx] = nextItem;
      writeData(collection, data);
      if (collection === 'rentals') {
        syncLinkedGanttRental(meta.linkedGanttRentalId, previousRental, nextItem, req.user.userName);
      }
      return res.json(data[idx]);
    });

    router.delete(`/${collection}/:id`, requireAuth, (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'DELETE');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });

      data.splice(idx, 1);
      writeData(collection, data);
      return res.json({ ok: true });
    });

    router.put(`/${collection}`, requireAuth, (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PUT');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const body = req.body;
      const list = Array.isArray(body) ? body : body.data;
      if (!Array.isArray(list)) {
        return res.status(400).json({ ok: false, error: 'Expected array' });
      }

      const equipment = readData('equipment') || [];
      for (const item of list) {
        const validation = validateRentalPayload(collection, item, list, equipment, item.id);
        if (!validation.ok) {
          return res.status(validation.status).json({ ok: false, error: validation.error });
        }
      }

      const nextList = collection === 'gantt_rentals'
        ? normalizeGanttRentalList(list)
        : list;

      writeData(collection, nextList);
      return res.json({ ok: true, count: nextList.length });
    });
  }

  registerRentalCollection('rentals');
  registerRentalCollection('gantt_rentals');

  return router;
}

module.exports = {
  registerRentalRoutes,
};
