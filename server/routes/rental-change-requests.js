const express = require('express');
const { syncGanttRentalPaymentStatuses } = require('../lib/payment-status-sync');
const {
  assertPaymentAllocationPersistenceEntriesSafe,
  canonicalizePaymentCounterpartyRelation,
} = require('../lib/payment-counterparty-relations');
const {
  RENTAL_CHANGE_REQUEST_STATUS,
  appendRentalHistory,
  buildRequestDecisionNotificationStatus,
  displayValue,
  resolveRentalForChangeRequest,
  syncGanttRentalFields,
} = require('../lib/rental-change-requests');
const { createRentalHistoryEntry } = require('../lib/audit-history');
const { normalizeClientRelationLinks } = require('../lib/client-relations');
const {
  canonicalizeRentalPatch,
  rentalServerOwnedAuditFields,
} = require('../lib/rental-data-integrity');
const {
  affectedEquipmentIdsForRentals,
  reconcileEquipmentRentalProjection,
  validateRentalLifecycleAvailability,
  validateTerminalRentalTransition,
} = require('../lib/rental-lifecycle');

const RENTAL_RELATION_AND_SNAPSHOT_FIELDS = new Set([
  'counterpartyId',
  'clientId',
  'objectId',
  'objectName',
  'objectAddress',
  'objectContactName',
  'objectContactPhone',
  'contractId',
  'contractNumber',
]);

function registerRentalChangeRequestRoutes(deps) {
  const {
    readData,
    writeData,
    writeDataBatch: persistDataBatch,
    requireAuth,
    requireRead = () => (_req, _res, next) => next(),
    validateRentalPayload,
    generateId,
    idPrefixes,
    accessControl,
    nowIso = () => new Date().toISOString(),
    canonicalizeRentalRelationForWrite = rental => rental,
  } = deps;
  if (typeof persistDataBatch !== 'function') {
    throw new TypeError('Rental change requests require an atomic batch writer.');
  }

  const router = express.Router();
  const collection = 'rental_change_requests';

  function isAdmin(req) {
    return req.user?.userRole === 'Администратор';
  }

  function readRequests() {
    return readData(collection) || [];
  }

  function writeRequests(list) {
    writeData(collection, Array.isArray(list) ? list : []);
  }

  function visibleRequests(req) {
    const requests = readRequests();
    if (isAdmin(req)) return requests;
    return requests.filter(item => item.initiatorId === req.user?.userId);
  }

  function findRequestOr404(id) {
    const requests = [...readRequests()];
    const idx = requests.findIndex(item => item.id === id);
    return { requests, idx, request: idx === -1 ? null : requests[idx] };
  }

  function requireAdmin(req, res) {
    if (isAdmin(req)) return true;
    res.status(403).json({ ok: false, error: 'Forbidden: admin only' });
    return false;
  }

  function nextPaymentStatusProjection(payments) {
    const currentGanttRentals = readData('gantt_rentals') || [];
    return syncGanttRentalPaymentStatuses(currentGanttRentals, payments, readData('payment_allocations') || []);
  }

  function sameId(left, right) {
    return String(left || '').trim() === String(right || '').trim();
  }

  function ganttLinksRental(ganttRental, rentalId) {
    return [
      ganttRental?.rentalId,
      ganttRental?.sourceRentalId,
      ganttRental?.originalRentalId,
    ].some(id => sameId(id, rentalId));
  }

  function validateExpectedOldValue(request, rental) {
    const field = request.field;
    if (!field) {
      return { ok: false, status: 400, error: 'В заявке не указано поле изменения.' };
    }
    const expected = Object.prototype.hasOwnProperty.call(request.oldValues || {}, field)
      ? request.oldValues[field]
      : request.oldValue;
    const actual = rental?.[field];
    if (String(expected ?? '') !== String(actual ?? '')) {
      return {
        ok: false,
        status: 409,
        error: 'Даты или поля аренды уже изменились. Обновите заявку и повторите согласование.',
      };
    }
    return { ok: true };
  }

  function managerDisplayName(user) {
    return String(user?.name || user?.userName || user?.fullName || user?.email || '').trim();
  }

  function canonicalizeManagerPair(rental, field) {
    if (!['manager', 'managerId'].includes(field)) return { rental };
    const users = readData('users') || [];
    const managerId = String(rental?.managerId || '').trim();
    const manager = String(rental?.manager || '').trim();
    const user = managerId
      ? users.find(item => String(item?.id || '').trim() === managerId)
      : users.find(item => managerDisplayName(item).toLowerCase().replace(/ё/g, 'е') === manager.toLowerCase().replace(/ё/g, 'е'));
    if (!user) {
      return {
        error: {
          ok: false,
          status: 400,
          code: 'RENTAL_MANAGER_NOT_FOUND',
          error: 'Менеджер для согласования не найден.',
          field: managerId ? 'managerId' : 'manager',
        },
      };
    }
    return {
      rental: {
        ...rental,
        managerId: String(user.id || ''),
        manager: managerDisplayName(user),
      },
    };
  }

  function canonicalizeEquipmentSnapshot(rental, field) {
    if (!['equipmentId', 'equipmentInv', 'inventoryNumber', 'serialNumber', 'equipment'].includes(field)) return rental;
    const equipment = (readData('equipment') || []).find(item => String(item?.id || '') === String(rental?.equipmentId || ''));
    if (!equipment) return rental;
    const inventoryNumber = equipment.inventoryNumber || equipment.equipmentInv || '';
    return {
      ...rental,
      equipmentId: equipment.id,
      equipmentInv: inventoryNumber,
      inventoryNumber,
      serialNumber: equipment.serialNumber || '',
      equipment: inventoryNumber ? [inventoryNumber] : (equipment.serialNumber ? [equipment.serialNumber] : []),
    };
  }

  function relatedRentalHistoryWrite(rentalId, entry) {
    if (!rentalId || !entry) return null;
    const rentals = [...(readData('rentals') || [])];
    const resolution = resolveRentalForChangeRequest({
      rentalId,
      rentals,
      ganttRentals: readData('gantt_rentals') || [],
    });
    if (!resolution.ok) return null;
    rentals[resolution.rentalIndex] = appendRentalHistory(rentals[resolution.rentalIndex], [entry]);
    return { name: 'rentals', value: rentals };
  }

  function applyRentalRequest(request, adminName) {
    if (!request.rentalId) {
      return { ok: false, status: 400, error: 'В заявке отсутствует rentalId. Согласование заблокировано.' };
    }
    const forbiddenAuditFields = rentalServerOwnedAuditFields({ [request.field]: request.newValue });
    if (forbiddenAuditFields.length > 0) {
      return {
        ok: false,
        status: 403,
        error: `Audit-поля аренды нельзя менять через согласование: ${forbiddenAuditFields.join(', ')}.`,
      };
    }

    const rentals = [...(readData('rentals') || [])];
    const rentalIdx = rentals.findIndex(item => sameId(item?.id, request.rentalId));
    if (rentalIdx === -1) {
      return { ok: false, status: 404, error: 'Аренда не найдена. Согласование заблокировано.' };
    }

    const previousRental = rentals[rentalIdx];
    const oldValueValidation = validateExpectedOldValue(request, previousRental);
    if (!oldValueValidation.ok) return oldValueValidation;

    let nextRental;
    try {
      nextRental = canonicalizeRentalPatch(previousRental, {
        [request.field]: request.newValue,
      }).rental;
    } catch (error) {
      return {
        ok: false,
        status: error?.status || 400,
        code: error?.code,
        error: error.message,
        field: error?.field,
        fieldErrors: error?.fieldErrors,
      };
    }
    const managerCanonicalization = canonicalizeManagerPair(nextRental, request.field);
    if (managerCanonicalization.error) return managerCanonicalization.error;
    nextRental = canonicalizeEquipmentSnapshot(managerCanonicalization.rental, request.field);
    if (RENTAL_RELATION_AND_SNAPSHOT_FIELDS.has(request.field)) {
      try {
        if (
          request.field === 'clientId'
          && String(nextRental.clientId || '') !== String(previousRental.clientId || '')
        ) {
          nextRental = { ...nextRental };
          delete nextRental.counterpartyId;
        }
        nextRental = normalizeClientRelationLinks(nextRental, nextRental.clientId, {
          readData,
          requireActiveObject: String(nextRental.objectId || '') !== String(previousRental.objectId || ''),
          allowArchivedObjectId: previousRental.objectId,
          requireActiveContract: String(nextRental.contractId || '') !== String(previousRental.contractId || ''),
          allowArchivedContractId: previousRental.contractId,
          includeObjectSnapshot: true,
          includeContractSnapshot: true,
        });
        nextRental = canonicalizeRentalRelationForWrite(nextRental);
      } catch (error) {
        return {
          ok: false,
          status: error?.status || 400,
          code: error?.code,
          error: error.message,
          field: error?.field,
        };
      }
    }
    const terminalValidation = validateTerminalRentalTransition(previousRental, nextRental);
    if (!terminalValidation.ok) return terminalValidation;
    const validation = validateRentalPayload(
      'rentals',
      nextRental,
      rentals,
      readData('equipment') || [],
      previousRental.id,
    );
    if (!validation.ok) return validation;
    if (['equipmentId', 'equipmentInv', 'inventoryNumber', 'serialNumber', 'equipment', 'startDate', 'plannedReturnDate', 'endDate', 'status'].includes(request.field)) {
      const lifecycleValidation = validateRentalLifecycleAvailability({
        rental: nextRental,
        equipmentList: readData('equipment') || [],
        serviceTickets: readData('service') || [],
        equipmentDowntimes: readData('equipment_downtimes') || [],
      });
      if (!lifecycleValidation.ok) return lifecycleValidation;
    }

    const ganttRentals = [...(readData('gantt_rentals') || [])];
    const ganttIndexesToUpdate = new Set();
    if (request.linkedGanttRentalId) {
      const linkedIdx = ganttRentals.findIndex(item => sameId(item?.id, request.linkedGanttRentalId));
      if (linkedIdx !== -1 && ganttLinksRental(ganttRentals[linkedIdx], request.rentalId)) {
        ganttIndexesToUpdate.add(linkedIdx);
      }
    }
    ganttRentals.forEach((item, index) => {
      if (ganttLinksRental(item, request.rentalId)) ganttIndexesToUpdate.add(index);
    });

    const equipment = readData('equipment') || [];
    const nextGanttByIndex = new Map();
    for (const ganttIdx of ganttIndexesToUpdate) {
      const nextGanttRental = syncGanttRentalFields(
        ganttRentals[ganttIdx],
        previousRental,
        nextRental,
        adminName,
        equipment,
      );
      const ganttValidation = validateRentalPayload(
        'gantt_rentals',
        nextGanttRental,
        ganttRentals,
        equipment,
        nextGanttRental.id,
      );
      if (!ganttValidation.ok) return ganttValidation;
      nextGanttByIndex.set(ganttIdx, nextGanttRental);
    }

    rentals[rentalIdx] = Array.isArray(nextRental.history) && nextRental.history.length > 0 ? nextRental : appendRentalHistory(nextRental, [
      createRentalHistoryEntry(
        adminName,
        `Согласовано и применено: ${request.fieldLabel || request.field}: ${displayValue(request.oldValue)} → ${displayValue(request.newValue)}`,
      ),
    ]);
    for (const [ganttIdx, nextGanttRental] of nextGanttByIndex) {
      ganttRentals[ganttIdx] = nextGanttRental;
    }

    const equipmentList = readData('equipment') || [];
    const lifecycle = reconcileEquipmentRentalProjection({
      equipmentList,
      rentals,
      ganttRentals,
      serviceTickets: readData('service') || [],
      affectedEquipmentIds: affectedEquipmentIdsForRentals([previousRental, nextRental], equipmentList),
      nowIso,
      author: adminName,
      reason: `Согласование изменения аренды ${nextRental.id}`,
    });

    return {
      ok: true,
      writes: [
        { name: 'rentals', value: rentals },
        ...(ganttIndexesToUpdate.size > 0 ? [{ name: 'gantt_rentals', value: ganttRentals }] : []),
        ...(lifecycle.changed ? [{ name: 'equipment', value: lifecycle.nextEquipment }] : []),
      ],
    };
  }
  function applyPaymentRequest(request, adminName) {
    const payments = [...(readData('payments') || [])];
    const paymentId = request.entityId || request.paymentId;
    const paymentIdx = payments.findIndex(item => item.id === paymentId);
    if (paymentIdx === -1) {
      return { ok: false, status: 404, error: 'Платёж для заявки не найден' };
    }

    if (request.operation === 'delete') {
      payments.splice(paymentIdx, 1);
    } else {
      let safePatch = request.newValue && typeof request.newValue === 'object' ? { ...request.newValue } : {};
      delete safePatch.id;
      if (accessControl?.sanitizePaymentMutationInput) {
        try {
          safePatch = accessControl.sanitizePaymentMutationInput(safePatch);
        } catch (error) {
          return { ok: false, status: error?.status || 400, error: error?.message || 'Некорректные поля платежа' };
        }
      }
      try {
        payments[paymentIdx] = canonicalizePaymentCounterpartyRelation({
          ...payments[paymentIdx],
          ...safePatch,
          id: payments[paymentIdx].id,
        }, { readData });
      } catch (error) {
        return {
          ok: false,
          status: error?.status || 400,
          code: error?.code,
          error: error?.message || 'Некорректная связь платежа с контрагентом',
        };
      }
    }

    const historyWrite = relatedRentalHistoryWrite(
      request.rentalId,
      createRentalHistoryEntry(adminName, `Согласовано и применено: ${request.type}`),
    );
    return {
      ok: true,
      writes: [
        { name: 'payments', value: payments },
        { name: 'gantt_rentals', value: nextPaymentStatusProjection(payments) },
        ...(historyWrite ? [historyWrite] : []),
      ],
    };
  }

  function applyDocumentRequest(request, adminName) {
    const documents = [...(readData('documents') || [])];
    const documentId = request.entityId || request.documentId;
    const documentIdx = documents.findIndex(item => item.id === documentId);
    if (documentIdx === -1) {
      return { ok: false, status: 404, error: 'Документ для заявки не найден' };
    }

    if (request.operation === 'delete') {
      documents.splice(documentIdx, 1);
      const historyWrite = relatedRentalHistoryWrite(
        request.rentalId,
        createRentalHistoryEntry(adminName, `Согласовано и применено: ${request.type}`),
      );
      return {
        ok: true,
        writes: [
          { name: 'documents', value: documents },
          ...(historyWrite ? [historyWrite] : []),
        ],
      };
    }

    return { ok: false, status: 400, error: 'Неизвестная операция по документу' };
  }

  function applyRequest(request, adminName) {
    if (request.entityType === 'payment') return applyPaymentRequest(request, adminName);
    if (request.entityType === 'document') return applyDocumentRequest(request, adminName);
    return applyRentalRequest(request, adminName);
  }

  router.get(`/${collection}`, requireAuth, requireRead(collection), (req, res) => {
    return res.json(visibleRequests(req));
  });

  router.get(`/${collection}/:id`, requireAuth, requireRead(collection), (req, res) => {
    const request = visibleRequests(req).find(item => item.id === req.params.id);
    if (!request) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json(request);
  });

  router.post(`/${collection}/:id/approve`, requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;

    const { requests, idx, request } = findRequestOr404(req.params.id);
    if (!request) return res.status(404).json({ ok: false, error: 'Not found' });
    if (request.status !== RENTAL_CHANGE_REQUEST_STATUS.PENDING) {
      return res.status(409).json({ ok: false, error: 'Заявка уже обработана' });
    }

    const adminName = req.user?.userName || 'Администратор';
    const applied = applyRequest(request, adminName);
    if (!applied.ok) {
      return res.status(applied.status || 400).json({
        ok: false,
        code: applied.code,
        error: applied.error || 'Не удалось применить заявку',
        field: applied.field,
        fieldErrors: applied.fieldErrors,
      });
    }

    const decidedAt = new Date().toISOString();
    requests[idx] = {
      ...request,
      status: RENTAL_CHANGE_REQUEST_STATUS.APPROVED,
      statusLabel: buildRequestDecisionNotificationStatus(RENTAL_CHANGE_REQUEST_STATUS.APPROVED),
      decidedAt,
      appliedAt: decidedAt,
      decidedById: req.user?.userId || '',
      decidedByName: adminName,
      adminComment: String(req.body?.comment || '').trim(),
    };
    if (Array.isArray(applied.writes)) {
      try {
        const writes = [
          ...applied.writes,
          { name: collection, value: requests },
        ];
        assertPaymentAllocationPersistenceEntriesSafe(writes, { readData });
        persistDataBatch(writes);
      } catch (error) {
        return res.status(error?.status || 500).json({
          ok: false,
          code: error?.code,
          error: error.message || 'Не удалось атомарно применить согласование.',
          ...(error?.details ? { details: error.details } : {}),
        });
      }
    } else {
      writeRequests(requests);
    }
    return res.json(requests[idx]);
  });

  router.post(`/${collection}/:id/reject`, requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;

    const rejectionReason = String(req.body?.reason || '').trim();
    if (!rejectionReason) {
      return res.status(400).json({ ok: false, error: 'Укажите причину отклонения' });
    }

    const { requests, idx, request } = findRequestOr404(req.params.id);
    if (!request) return res.status(404).json({ ok: false, error: 'Not found' });
    if (request.status !== RENTAL_CHANGE_REQUEST_STATUS.PENDING) {
      return res.status(409).json({ ok: false, error: 'Заявка уже обработана' });
    }

    requests[idx] = {
      ...request,
      status: RENTAL_CHANGE_REQUEST_STATUS.REJECTED,
      statusLabel: buildRequestDecisionNotificationStatus(RENTAL_CHANGE_REQUEST_STATUS.REJECTED),
      decidedAt: new Date().toISOString(),
      decidedById: req.user?.userId || '',
      decidedByName: req.user?.userName || 'Администратор',
      rejectionReason,
    };
    writeRequests(requests);
    return res.json(requests[idx]);
  });

  router.post(`/${collection}`, requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const requests = readRequests();
    const item = {
      ...req.body,
      id: req.body?.id || generateId(idPrefixes[collection] || 'RCR'),
      createdAt: req.body?.createdAt || new Date().toISOString(),
      status: req.body?.status || RENTAL_CHANGE_REQUEST_STATUS.PENDING,
    };
    requests.push(item);
    writeRequests(requests);
    return res.status(201).json(item);
  });

  return router;
}

module.exports = {
  registerRentalChangeRequestRoutes,
};
