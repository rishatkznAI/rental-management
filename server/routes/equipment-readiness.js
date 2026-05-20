const express = require('express');
const { buildFleetReadinessReport } = require('../lib/equipment-readiness');

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
    const equipment = scopedCollection({ collection: 'equipment', req, readData, accessControl, canReadCollection });
    const rentals = internalCollection(readData, 'rentals');
    const ganttRentals = internalCollection(readData, 'gantt_rentals');
    const serviceTickets = internalCollection(readData, 'service');
    const deliveries = internalCollection(readData, 'deliveries');
    const documents = internalCollection(readData, 'documents');
    const gsmPackets = internalCollection(readData, 'gsm_packets');
    const shippingPhotos = internalCollection(readData, 'shipping_photos');

    const report = buildFleetReadinessReport({
      equipment,
      rentals,
      ganttRentals,
      serviceTickets,
      deliveries,
      documents,
      gsmPackets,
      shippingPhotos,
    });

    return res.json({
      ok: true,
      summary: report.summary,
      items: report.items,
    });
  });

  return router;
}

module.exports = {
  registerEquipmentReadinessRoutes,
};
