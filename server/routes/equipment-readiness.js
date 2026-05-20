const express = require('express');
const { buildFleetReadinessReport, buildManagementActionQueue } = require('../lib/equipment-readiness');

function scopedCollection({ collection, req, readData, accessControl, canReadCollection }) {
  if (typeof canReadCollection === 'function' && !canReadCollection(req, collection)) return [];
  const raw = readData(collection) || [];
  const scoped = accessControl?.filterCollectionByScope
    ? accessControl.filterCollectionByScope(collection, raw, req.user)
    : raw;
  return accessControl?.sanitizeCollectionForRead
    ? accessControl.sanitizeCollectionForRead(collection, scoped, req.user)
    : scoped;
}

function internalCollection(readData, collection) {
  const data = readData(collection);
  return Array.isArray(data) ? data : [];
}

function managementActionAreasForUser(user, accessControl) {
  if (!user || !accessControl) return new Set();
  if (
    accessControl.isAdmin?.(user) ||
    accessControl.isOfficeManager?.(user) ||
    accessControl.isRentalManager?.(user) ||
    accessControl.isSalesManager?.(user)
  ) {
    return null;
  }
  if (accessControl.isServiceForeman?.(user) || accessControl.isMechanic?.(user)) {
    return new Set(['service', 'admin']);
  }
  if (accessControl.isCarrierDelivery && String(user.role || user.userRole || '').trim() === 'Перевозчик') {
    return new Set(['logistics']);
  }
  return new Set();
}

function filterActionQueueForUser(queue, user, accessControl) {
  const allowedAreas = managementActionAreasForUser(user, accessControl);
  if (allowedAreas === null) return queue;
  const items = queue.items.filter(item => allowedAreas.has(item.responsibleArea));
  return buildActionQueueSummary(items);
}

function buildActionQueueSummary(items) {
  const byResponsibleArea = {
    service: 0,
    logistics: 0,
    office: 0,
    rental_manager: 0,
    admin: 0,
    unknown: 0,
  };
  const summary = {
    total: items.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    totalEstimatedLoss: 0,
    totalDailyLoss: 0,
    byResponsibleArea,
  };
  const roundMoney = value => Math.round(value * 100) / 100;
  for (const item of items) {
    if (summary[item.priority] !== undefined) summary[item.priority] += 1;
    summary.totalEstimatedLoss = roundMoney(summary.totalEstimatedLoss + Number(item.estimatedLoss || 0));
    summary.totalDailyLoss = roundMoney(summary.totalDailyLoss + Number(item.estimatedDailyLoss || 0));
    byResponsibleArea[item.responsibleArea] = (byResponsibleArea[item.responsibleArea] || 0) + 1;
  }
  return { summary, items };
}

function actionQueueContext({ readData, req, accessControl, canReadCollection }) {
  return {
    equipment: scopedCollection({ collection: 'equipment', req, readData, accessControl, canReadCollection }),
    rentals: internalCollection(readData, 'rentals'),
    ganttRentals: internalCollection(readData, 'gantt_rentals'),
    serviceTickets: internalCollection(readData, 'service'),
    deliveries: internalCollection(readData, 'deliveries'),
    documents: internalCollection(readData, 'documents'),
    gsmPackets: internalCollection(readData, 'gsm_packets'),
    shippingPhotos: internalCollection(readData, 'shipping_photos'),
  };
}

function registerEquipmentReadinessRoutes(deps) {
  const {
    readData,
    requireAuth,
    requireRead,
    canReadCollection,
    accessControl,
  } = deps;

  const router = express.Router();

  router.get('/equipment/readiness', requireAuth, requireRead('equipment'), (req, res) => {
    const report = buildFleetReadinessReport(actionQueueContext({ readData, req, accessControl, canReadCollection }));

    return res.json({
      ok: true,
      summary: report.summary,
      items: report.items,
    });
  });

  router.get('/management/action-queue', requireAuth, (req, res) => {
    const queue = buildManagementActionQueue(actionQueueContext({ readData, req, accessControl, canReadCollection }));
    const visibleQueue = filterActionQueueForUser(queue, req.user, accessControl);
    return res.json({
      ok: true,
      summary: visibleQueue.summary,
      items: visibleQueue.items,
    });
  });

  return router;
}

module.exports = {
  registerEquipmentReadinessRoutes,
};
