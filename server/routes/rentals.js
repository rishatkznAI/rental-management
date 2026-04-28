const express = require('express');
const {
  appendRentalHistory,
  buildRentalChangeRequest,
  buildRentalImmediateHistoryEntries,
  buildRentalPendingApprovalHistoryEntries,
  displayValue,
  getFieldLabel,
  resolveRentalForChangeRequest,
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
    normalizeRecordClientLink,
    generateId,
    idPrefixes,
    accessControl,
    auditLog,
  } = deps;

  const router = express.Router();
  const requiredAccessMethods = ['filterCollectionByScope', 'canAccessEntity', 'assertCanUpdateEntity', 'splitForbiddenRentalManagerPatch'];
  const missingAccessMethods = !accessControl
    ? requiredAccessMethods
    : requiredAccessMethods.filter(name => typeof accessControl[name] !== 'function');
  if (missingAccessMethods.length > 0) {
    throw new Error(`Rental routes require access-control methods: ${missingAccessMethods.join(', ')}`);
  }

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

    function withClientLink(item, context) {
      if (typeof normalizeRecordClientLink !== 'function') return item;
      return normalizeRecordClientLink(item, readData('clients') || [], {
        context: context || `${collection}:${item?.id || 'new'}`,
        logger: console,
      });
    }

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
        sourceRentalId: meta.sourceRentalId,
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
      let nextItem = withClientLink({ ...previousRental, ...nextPatch, id: previousRental.id }, `${collection}:approval:${previousRental.id}`);
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
        nextItem = withClientLink({ ...previousRental, ...nextPatch, id: previousRental.id }, `${collection}:approval:${previousRental.id}`);
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
      const data = readData(collection) || [];
      return res.json(accessControl.filterCollectionByScope(collection, data, req.user));
    });

    router.get(`/${collection}/:id`, requireAuth, requireRead(collection), (req, res) => {
      const data = readData(collection) || [];
      const item = data.find(entry => entry.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
      if (!accessControl.canAccessEntity(collection, item, req.user)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
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

      let newItem = withClientLink({ ...req.body, id: req.body.id || generateId(prefix) }, `${collection}:create`);
      if (collection === 'gantt_rentals') {
        newItem = normalizeGanttRentalStatus(newItem);
        newItem = mergeRentalHistory(null, newItem, req.user.userName);
      }
      data.push(newItem);
      writeData(collection, data);
      auditLog?.(req, {
        action: `${collection}.create`,
        entityType: collection,
        entityId: newItem.id,
        after: newItem,
      });
      return res.status(201).json(newItem);
    });

    router.patch(`/${collection}/:id`, requireAuth, (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const { patch, meta: rawMeta } = stripRentalPatchMeta(req.body);
      let meta = rawMeta;
      const data = readData(collection) || [];
      let idx = data.findIndex(entry => String(entry.id) === String(req.params.id));
      if (collection === 'rentals') {
        const resolution = resolveRentalForChangeRequest({
          rentalId: rawMeta.rentalId || req.params.id,
          linkedGanttRentalId: rawMeta.linkedGanttRentalId,
          rentals: data,
          ganttRentals: readData('gantt_rentals') || [],
        });
        if (!resolution.ok) {
          return res.status(resolution.status).json({
            ok: false,
            error: resolution.error,
            details: resolution.details,
          });
        }
        idx = resolution.rentalIndex;
        meta = {
          ...rawMeta,
          sourceRentalId: rawMeta.sourceRentalId || resolution.sourceRentalId || '',
          linkedGanttRentalId: rawMeta.linkedGanttRentalId || resolution.linkedGanttRentalId || '',
        };
      }
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      try {
        accessControl.assertCanUpdateEntity(collection, data[idx], req.user);
      } catch (error) {
        return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
      }

      if (collection === 'rentals' && req.user?.userRole !== 'Администратор') {
        const previousRental = data[idx];
        const managerSplit = req.user?.userRole === 'Менеджер по аренде'
          ? accessControl.splitForbiddenRentalManagerPatch(previousRental, patch)
          : { immediatePatch: patch, approvalFields: [] };
        const { immediatePatch, approvalChanges } = splitRentalPatch({
          previousRental,
          patch: managerSplit.immediatePatch,
          payments: readData('payments') || [],
        });
        for (const field of managerSplit.approvalFields || []) {
          approvalChanges.push({
            field,
            label: getFieldLabel(field),
            oldValue: previousRental?.[field],
            newValue: patch[field],
            type: 'Критичное изменение аренды',
            reason: 'Критичные поля аренды меняются через согласование администратора.',
          });
        }

        const immediateValidation = validateImmediateRentalPatch(previousRental, immediatePatch, data, approvalChanges, meta, req.user.userName);
        if (!immediateValidation.ok) {
          return res.status(immediateValidation.status).json({ ok: false, error: immediateValidation.error });
        }

        const createdRequests = createApprovalRequests(previousRental, approvalChanges, meta, req);
        let nextItem = immediateValidation.nextItem;
        const appliedFields = Object.keys(immediateValidation.patch || {});
        const pendingHistoryEntries = buildRentalPendingApprovalHistoryEntries(createdRequests, req.user.userName);
        if (appliedFields.length > 0) {
          nextItem = appendRentalHistory(
            nextItem,
            [
              ...buildRentalImmediateHistoryEntries(previousRental, nextItem, req.user.userName),
              ...pendingHistoryEntries,
            ],
          );
          data[idx] = nextItem;
          writeData(collection, data);
          auditLog?.(req, {
            action: 'rentals.update',
            entityType: 'rentals',
            entityId: nextItem.id,
            before: previousRental,
            after: nextItem,
          });
          syncLinkedGanttRental(meta.linkedGanttRentalId, previousRental, nextItem, req.user.userName);
        } else if (createdRequests.length > 0) {
          data[idx] = appendRentalHistory(previousRental, pendingHistoryEntries);
          writeData(collection, data);
          auditLog?.(req, {
            action: 'rentals.change_request',
            entityType: 'rentals',
            entityId: previousRental.id,
            after: { requestIds: createdRequests.map(item => item.id) },
          });
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

      let nextItem = withClientLink({ ...data[idx], ...patch, id: data[idx].id }, `${collection}:update:${data[idx].id}`);
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
      auditLog?.(req, {
        action: `${collection}.update`,
        entityType: collection,
        entityId: nextItem.id,
        before: previousRental,
        after: nextItem,
      });
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
      auditLog?.(req, {
        action: `${collection}.delete`,
        entityType: collection,
        entityId: req.params.id,
      });
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

      const linkedList = list.map(item => withClientLink(item, `${collection}:bulk:${item?.id || 'new'}`));
      const nextList = collection === 'gantt_rentals'
        ? normalizeGanttRentalList(linkedList)
        : linkedList;

      writeData(collection, nextList);
      auditLog?.(req, {
        action: `${collection}.bulk_replace`,
        entityType: collection,
        after: { count: nextList.length },
      });
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
