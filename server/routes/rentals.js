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
      // IMPORTANT: rentals carry clientId as the durable link. The client name is editable
      // display text and must not be the source of debt/payment/document relationships.
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

    function mergeGanttRentalForRepair(primary, fallback) {
      if (!fallback) return primary;
      if (!primary) return fallback;
      return {
        ...fallback,
        ...primary,
        clientId: primary.clientId || fallback.clientId,
        client: primary.client || fallback.client,
        clientShort: primary.clientShort || fallback.clientShort,
        equipmentId: primary.equipmentId || fallback.equipmentId,
        equipmentInv: primary.equipmentInv || fallback.equipmentInv || fallback.inventoryNumber,
        startDate: primary.startDate || fallback.startDate,
        endDate: primary.endDate || primary.plannedReturnDate || fallback.endDate || fallback.plannedReturnDate,
        manager: primary.manager || fallback.manager,
        managerId: primary.managerId || fallback.managerId,
        amount: primary.amount ?? fallback.amount,
      };
    }

    function generateUniqueRentalId(existingRentals) {
      const existingIds = new Set((existingRentals || []).map(item => String(item?.id || '')));
      let id = generateId(prefix);
      for (let attempt = 0; attempt < 5 && existingIds.has(id); attempt += 1) {
        id = generateId(prefix);
      }
      return id;
    }

    function buildClassicRentalFromGantt(ganttRental, rawMeta, author, existingRentals) {
      const equipmentList = readData('equipment') || [];
      const equipmentById = equipmentList.find(item => item.id === ganttRental.equipmentId);
      const equipmentInv = ganttRental.equipmentInv || ganttRental.inventoryNumber || equipmentById?.inventoryNumber || '';
      const oldValues = rawMeta.oldValues || {};
      const restored = withClientLink({
        id: generateUniqueRentalId(existingRentals),
        clientId: ganttRental.clientId || oldValues.clientId || '',
        client: ganttRental.client || oldValues.client || '',
        contact: ganttRental.contact || '',
        startDate: oldValues.startDate || ganttRental.startDate || '',
        plannedReturnDate: oldValues.plannedReturnDate || oldValues.endDate || ganttRental.endDate || ganttRental.plannedReturnDate || '',
        equipmentId: ganttRental.equipmentId || '',
        equipmentInv,
        equipment: equipmentInv ? [equipmentInv] : (ganttRental.equipmentId ? [ganttRental.equipmentId] : []),
        rate: ganttRental.rate || '',
        price: Number(ganttRental.amount ?? ganttRental.price) || 0,
        discount: Number(ganttRental.discount) || 0,
        deliveryAddress: ganttRental.deliveryAddress || '',
        deliveryTime: ganttRental.deliveryTime || '',
        manager: ganttRental.manager || '',
        managerId: ganttRental.managerId || '',
        status: ganttRental.status === 'closed' || ganttRental.status === 'returned' ? ganttRental.status : 'active',
        expectedPaymentDate: ganttRental.expectedPaymentDate || '',
        paymentStatus: ganttRental.paymentStatus || '',
        documents: Array.isArray(ganttRental.documents) ? ganttRental.documents : [],
        comments: '',
        history: [{
          date: new Date().toISOString(),
          text: `Карточка аренды восстановлена из записи планировщика ${ganttRental.id}`,
          author: author || 'Система',
          type: 'system',
        }],
      }, `rentals:repair-from-gantt:${ganttRental.id}`);
      return restored;
    }

    function restoreOrphanGanttRentalIfSafe(req, data, rawMeta, fallbackGanttRental, resolution) {
      if (collection !== 'rentals') return null;
      if (resolution?.status !== 404) return null;
      const requestedIds = [
        req.params.id,
        rawMeta.linkedGanttRentalId,
        rawMeta.ganttRentalId,
        fallbackGanttRental?.id,
      ].map(value => String(value || '').trim()).filter(Boolean);
      if (!requestedIds.some(value => /^GR-/i.test(value))) return null;

      const ganttRentals = readData('gantt_rentals') || [];
      const ganttIdx = ganttRentals.findIndex(item => requestedIds.some(id => String(item?.id || '') === id));
      if (ganttIdx === -1) return null;
      const exactGanttRental = ganttRentals[ganttIdx];
      if (exactGanttRental.rentalId || exactGanttRental.sourceRentalId || exactGanttRental.originalRentalId) return null;

      try {
        accessControl.assertCanUpdateEntity('gantt_rentals', exactGanttRental, req.user);
      } catch {
        return null;
      }

      const repairSource = mergeGanttRentalForRepair(exactGanttRental, fallbackGanttRental);
      const restoredRental = buildClassicRentalFromGantt(repairSource, rawMeta, req.user?.userName, data);
      const validation = validateRentalPayload('rentals', restoredRental, data, readData('equipment') || [], '', { skipConflictCheck: false });
      if (!validation.ok) {
        console.warn('[rental-approval] orphan gantt repair skipped', JSON.stringify({
          ganttRentalId: exactGanttRental.id,
          status: validation.status,
          error: validation.error,
        }));
        return null;
      }

      data.push(restoredRental);
      writeData('rentals', data);
      const repairedGanttRental = {
        ...exactGanttRental,
        rentalId: restoredRental.id,
        sourceRentalId: restoredRental.id,
        originalRentalId: exactGanttRental.originalRentalId || restoredRental.id,
      };
      ganttRentals[ganttIdx] = repairedGanttRental;
      writeData('gantt_rentals', ganttRentals);
      auditLog?.(req, {
        action: 'rentals.repair_from_gantt',
        entityType: 'rentals',
        entityId: restoredRental.id,
        after: { rentalId: restoredRental.id, ganttRentalId: repairedGanttRental.id },
      });
      return { restoredRental, ganttRentals };
    }

    function logRentalResolutionFailure(req, resolution, rawMeta) {
      if (resolution.status !== 404 && resolution.status !== 409) return;
      const details = resolution.details || {};
      const debug = buildRentalResolutionDebug(req, resolution, rawMeta);
      console.warn('[rental-approval] rental resolver failed', JSON.stringify({
        route: `${req.method} ${req.originalUrl || req.url}`,
        paramsId: req.params.id,
        rentalId: rawMeta.rentalId || '',
        linkedGanttRentalId: rawMeta.linkedGanttRentalId || rawMeta.ganttRentalId || '',
        sourceRentalId: rawMeta.sourceRentalId || '',
        status: resolution.status,
        searchedIds: details.searchedIds || [],
        foundRentalById: details.foundRentalById ?? 0,
        foundGanttById: details.foundGanttById ?? 0,
        foundGanttByLink: details.foundGanttByLink ?? 0,
        fallbackCandidateCount: details.fallbackCandidateCount ?? 0,
        rentalCandidateIds: details.rentalCandidateIds || [],
        ganttCandidateIds: details.ganttCandidateIds || [],
        fallbackCandidateIds: details.fallbackCandidateIds || [],
        possibleReason: debug.possibleReason,
        frontendAction: debug.frontendAction,
      }));
    }

    function buildRentalResolutionDebug(req, resolution, rawMeta) {
      const details = resolution.details || {};
      const receivedId = String(req.params.id || '');
      const receivedRentalId = String(rawMeta.rentalId || rawMeta.sourceRentalId || '');
      const receivedGanttRentalId = String(rawMeta.linkedGanttRentalId || rawMeta.ganttRentalId || '');
      const snapshot = rawMeta.ganttSnapshot && typeof rawMeta.ganttSnapshot === 'object' ? rawMeta.ganttSnapshot : null;
      const frontendAction = String(rawMeta.actionType || rawMeta.entityType || '').trim();
      const idLooksLikeGantt = /^GR-/i.test(receivedId);
      let possibleReason = 'Аренда не найдена по переданным идентификаторам.';
      let recommendation = 'Снимите Network body этого PATCH-запроса и проверьте production DB через /api/admin/rental-link-diagnostics?id=' + encodeURIComponent(receivedId);

      if (idLooksLikeGantt && !receivedRentalId && !receivedGanttRentalId && (details.foundGanttById ?? 0) === 0) {
        possibleReason = 'Frontend отправил только GR-id, которого нет в production gantt_rentals. Возможен старый frontend build, stale state/cache или временный клиентский GR-id.';
        recommendation = 'Очистите frontend cache/localStorage/sessionStorage, проверьте commit frontend и найдите источник GR-id в Network initiator.';
      } else if (idLooksLikeGantt && (details.foundGanttById ?? 0) === 0) {
        possibleReason = 'GR-id из URL не найден в production gantt_rentals.';
        recommendation = 'Проверьте, существует ли этот GR-id в рабочей DB и совпадает ли frontend с backend deployment.';
      } else if ((details.foundGanttById ?? 0) > 0 && Array.isArray(details.linkedIds) && details.linkedIds.length === 0) {
        possibleReason = 'gantt_rentals найден, но у него нет rentalId/sourceRentalId/originalRentalId.';
        recommendation = 'Запустите backfill и проверьте fallback-кандидаты. Если кандидатов несколько, исправьте связь вручную.';
      } else if (Array.isArray(details.linkedIds) && details.linkedIds.length > 0 && (details.foundRentalById ?? 0) === 0) {
        possibleReason = 'gantt_rentals содержит связь, но связанная rentals.id отсутствует.';
        recommendation = 'Проверьте целостность rentals/gantt_rentals и восстановите исходную карточку аренды или связь.';
      } else if ((details.fallbackCandidateCount ?? 0) > 1) {
        possibleReason = 'Fallback нашёл несколько похожих аренд, backend не может безопасно выбрать одну.';
        recommendation = 'Проставьте точный rentalId в gantt_rentals или отправьте rentalId из frontend.';
      }

      return {
        receivedId,
        receivedRentalId,
        receivedGanttRentalId,
        receivedSourceRentalId: String(rawMeta.sourceRentalId || ''),
        receivedGanttSnapshotId: String(rawMeta.ganttSnapshot?.id || ''),
        hasGanttSnapshot: Boolean(rawMeta.ganttSnapshot),
        snapshotClient: String(snapshot?.client || snapshot?.clientName || ''),
        snapshotClientId: String(snapshot?.clientId || ''),
        snapshotEquipmentId: String(snapshot?.equipmentId || ''),
        snapshotEquipmentInv: String(snapshot?.equipmentInv || snapshot?.inventoryNumber || ''),
        snapshotStartDate: String(snapshot?.startDate || ''),
        snapshotEndDate: String(snapshot?.endDate || snapshot?.plannedReturnDate || ''),
        oldStartDate: String(rawMeta.oldValues?.startDate || ''),
        oldEndDate: String(rawMeta.oldValues?.plannedReturnDate || rawMeta.oldValues?.endDate || ''),
        newStartDate: String(rawMeta.newValues?.startDate || req.body?.startDate || ''),
        newEndDate: String(rawMeta.newValues?.plannedReturnDate || rawMeta.newValues?.endDate || req.body?.plannedReturnDate || req.body?.endDate || ''),
        searchedCollections: details.searchedCollections || [],
        possibleReason,
        frontendAction,
        bodyKeys: Object.keys(req.body || {}).sort(),
        requestRoute: `${req.method} ${req.originalUrl || req.url}`,
        recommendation,
      };
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
      return res.json(accessControl.sanitizeCollectionForRead(
        collection,
        accessControl.filterCollectionByScope(collection, data, req.user),
        req.user,
      ));
    });

    router.get(`/${collection}/:id`, requireAuth, requireRead(collection), (req, res) => {
      const data = readData(collection) || [];
      const item = data.find(entry => entry.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
      if (!accessControl.canAccessEntity(collection, item, req.user)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      return res.json(accessControl.sanitizeEntityForRead(collection, item, req.user));
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
        const rawRentalId = String(rawMeta.rentalId || '').trim();
        const rawSourceRentalId = String(rawMeta.sourceRentalId || '').trim();
        const safeRentalId = /^GR-/i.test(rawRentalId) ? '' : rawRentalId;
        const safeSourceRentalId = /^GR-/i.test(rawSourceRentalId) ? '' : rawSourceRentalId;
        const linkedGanttRentalId = rawMeta.linkedGanttRentalId ||
          rawMeta.ganttRentalId ||
          (String(req.params.id || '').startsWith('GR-') ? req.params.id : '');
        const fallbackGanttRental = rawMeta.ganttSnapshot
          ? {
              ...rawMeta.ganttSnapshot,
              client: rawMeta.ganttSnapshot.client || rawMeta.oldValues?.client,
              clientId: rawMeta.ganttSnapshot.clientId || rawMeta.oldValues?.clientId,
              previousStartDate: rawMeta.oldValues?.startDate || rawMeta.ganttSnapshot.previousStartDate,
              previousEndDate:
                rawMeta.oldValues?.plannedReturnDate ||
                rawMeta.oldValues?.endDate ||
                rawMeta.ganttSnapshot.previousEndDate,
            }
          : rawMeta.ganttSnapshot;
        let ganttRentalsForResolution = readData('gantt_rentals') || [];
        let resolution = resolveRentalForChangeRequest({
          rentalId: safeRentalId || safeSourceRentalId || req.params.id,
          linkedGanttRentalId,
          fallbackGanttRental,
          rentals: data,
          ganttRentals: ganttRentalsForResolution,
          equipment: readData('equipment') || [],
          context: `${req.method} ${req.originalUrl || req.url}`,
        });
        if (!resolution.ok) {
          const repaired = restoreOrphanGanttRentalIfSafe(req, data, rawMeta, fallbackGanttRental, resolution);
          if (repaired) {
            ganttRentalsForResolution = repaired.ganttRentals;
            resolution = resolveRentalForChangeRequest({
              rentalId: repaired.restoredRental.id,
              linkedGanttRentalId,
              fallbackGanttRental: {
                ...fallbackGanttRental,
                rentalId: repaired.restoredRental.id,
                sourceRentalId: repaired.restoredRental.id,
                originalRentalId: repaired.restoredRental.id,
              },
              rentals: data,
              ganttRentals: ganttRentalsForResolution,
              equipment: readData('equipment') || [],
              context: `${req.method} ${req.originalUrl || req.url}`,
            });
          }
        }
        if (!resolution.ok) {
          const debug = buildRentalResolutionDebug(req, resolution, rawMeta);
          logRentalResolutionFailure(req, resolution, rawMeta);
          return res.status(resolution.status).json({
            ok: false,
            error: resolution.error,
            details: {
              ...resolution.details,
              ...debug,
            },
          });
        }
        idx = resolution.rentalIndex;
        meta = {
          ...rawMeta,
          sourceRentalId: safeSourceRentalId || resolution.sourceRentalId || '',
          linkedGanttRentalId: rawMeta.linkedGanttRentalId || rawMeta.ganttRentalId || resolution.linkedGanttRentalId || '',
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
