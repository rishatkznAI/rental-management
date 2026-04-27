const express = require('express');
const { syncGanttRentalPaymentStatuses } = require('../lib/payment-status-sync');
const {
  RENTAL_CHANGE_REQUEST_STATUS,
  appendRentalHistory,
  applyApprovedRentalChangeToGantt,
  buildRequestDecisionNotificationStatus,
  displayValue,
} = require('../lib/rental-change-requests');
const { createRentalHistoryEntry } = require('../lib/audit-history');

function registerRentalChangeRequestRoutes(deps) {
  const {
    readData,
    writeData,
    requireAuth,
    validateRentalPayload,
    generateId,
    idPrefixes,
  } = deps;

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
    const requests = readRequests();
    const idx = requests.findIndex(item => item.id === id);
    return { requests, idx, request: idx === -1 ? null : requests[idx] };
  }

  function requireAdmin(req, res) {
    if (isAdmin(req)) return true;
    res.status(403).json({ ok: false, error: 'Forbidden: admin only' });
    return false;
  }

  function syncPaymentStatuses(payments) {
    const currentGanttRentals = readData('gantt_rentals') || [];
    writeData('gantt_rentals', syncGanttRentalPaymentStatuses(currentGanttRentals, payments));
  }

  function appendRelatedRentalHistory(rentalId, entry) {
    if (!rentalId || !entry) return;
    const rentals = readData('rentals') || [];
    const idx = rentals.findIndex(item => item.id === rentalId);
    if (idx === -1) return;
    rentals[idx] = appendRentalHistory(rentals[idx], [entry]);
    writeData('rentals', rentals);
  }

  function applyRentalRequest(request, adminName) {
    const rentals = readData('rentals') || [];
    const rentalIdx = rentals.findIndex(item => item.id === request.rentalId);
    if (rentalIdx === -1) {
      return { ok: false, status: 404, error: 'Аренда для заявки не найдена' };
    }

    const previousRental = rentals[rentalIdx];
    const nextRental = {
      ...previousRental,
      [request.field]: request.newValue,
      id: previousRental.id,
    };
    const validation = validateRentalPayload(
      'rentals',
      nextRental,
      rentals,
      readData('equipment') || [],
      previousRental.id,
    );
    if (!validation.ok) {
      return validation;
    }

    if (request.linkedGanttRentalId) {
      const ganttRentals = readData('gantt_rentals') || [];
      const ganttRental = ganttRentals.find(item => item.id === request.linkedGanttRentalId);
      if (ganttRental) {
        const nextGanttRental = applyApprovedRentalChangeToGantt(ganttRental, request, adminName);
        const ganttValidation = validateRentalPayload(
          'gantt_rentals',
          nextGanttRental,
          ganttRentals,
          readData('equipment') || [],
          nextGanttRental.id,
        );
        if (!ganttValidation.ok) return ganttValidation;
      }
    }

    rentals[rentalIdx] = appendRentalHistory(nextRental, [
      createRentalHistoryEntry(
        adminName,
        `Согласовано и применено: ${request.fieldLabel || request.field}: ${displayValue(request.oldValue)} → ${displayValue(request.newValue)}`,
      ),
    ]);
    writeData('rentals', rentals);

    if (request.linkedGanttRentalId) {
      const ganttRentals = readData('gantt_rentals') || [];
      const ganttIdx = ganttRentals.findIndex(item => item.id === request.linkedGanttRentalId);
      if (ganttIdx !== -1) {
        ganttRentals[ganttIdx] = applyApprovedRentalChangeToGantt(ganttRentals[ganttIdx], request, adminName);
        writeData('gantt_rentals', ganttRentals);
      }
    }

    return { ok: true };
  }

  function applyPaymentRequest(request, adminName) {
    const payments = readData('payments') || [];
    const paymentId = request.entityId || request.paymentId;
    const paymentIdx = payments.findIndex(item => item.id === paymentId);
    if (paymentIdx === -1) {
      return { ok: false, status: 404, error: 'Платёж для заявки не найден' };
    }

    if (request.operation === 'delete') {
      payments.splice(paymentIdx, 1);
    } else {
      payments[paymentIdx] = {
        ...payments[paymentIdx],
        ...(request.newValue && typeof request.newValue === 'object' ? request.newValue : {}),
        id: payments[paymentIdx].id,
      };
    }

    writeData('payments', payments);
    syncPaymentStatuses(payments);
    appendRelatedRentalHistory(
      request.rentalId,
      createRentalHistoryEntry(adminName, `Согласовано и применено: ${request.type}`),
    );
    return { ok: true };
  }

  function applyDocumentRequest(request, adminName) {
    const documents = readData('documents') || [];
    const documentId = request.entityId || request.documentId;
    const documentIdx = documents.findIndex(item => item.id === documentId);
    if (documentIdx === -1) {
      return { ok: false, status: 404, error: 'Документ для заявки не найден' };
    }

    if (request.operation === 'delete') {
      documents.splice(documentIdx, 1);
      writeData('documents', documents);
      appendRelatedRentalHistory(
        request.rentalId,
        createRentalHistoryEntry(adminName, `Согласовано и применено: ${request.type}`),
      );
      return { ok: true };
    }

    return { ok: false, status: 400, error: 'Неизвестная операция по документу' };
  }

  function applyRequest(request, adminName) {
    if (request.entityType === 'payment') return applyPaymentRequest(request, adminName);
    if (request.entityType === 'document') return applyDocumentRequest(request, adminName);
    return applyRentalRequest(request, adminName);
  }

  router.get(`/${collection}`, requireAuth, (req, res) => {
    return res.json(visibleRequests(req));
  });

  router.get(`/${collection}/:id`, requireAuth, (req, res) => {
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
      return res.status(applied.status || 400).json({ ok: false, error: applied.error || 'Не удалось применить заявку' });
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
    writeRequests(requests);
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
