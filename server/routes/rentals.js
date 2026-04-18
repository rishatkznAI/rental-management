const express = require('express');

function registerRentalRoutes(deps) {
  const {
    readData,
    writeData,
    requireAuth,
    validateRentalPayload,
    generateId,
    idPrefixes,
  } = deps;

  const router = express.Router();

  function rentalWriteForbiddenReason(req, method) {
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

  function registerRentalCollection(collection) {
    const prefix = idPrefixes[collection] || collection;

    router.get(`/${collection}`, requireAuth, (req, res) => {
      return res.json(readData(collection) || []);
    });

    router.get(`/${collection}/:id`, requireAuth, (req, res) => {
      const data = readData(collection) || [];
      const item = data.find(entry => entry.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
      return res.json(item);
    });

    router.post(`/${collection}`, requireAuth, (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, 'POST');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const data = readData(collection) || [];
      const equipment = readData('equipment') || [];
      const validation = validateRentalPayload(collection, req.body, data, equipment);
      if (!validation.ok) {
        return res.status(validation.status).json({ ok: false, error: validation.error });
      }

      const newItem = { ...req.body, id: req.body.id || generateId(prefix) };
      data.push(newItem);
      writeData(collection, data);
      return res.status(201).json(newItem);
    });

    router.patch(`/${collection}/:id`, requireAuth, (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, 'PATCH');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });

      const nextItem = { ...data[idx], ...req.body, id: data[idx].id };
      const validation = validateRentalPayload(collection, nextItem, data, readData('equipment') || [], data[idx].id);
      if (!validation.ok) {
        return res.status(validation.status).json({ ok: false, error: validation.error });
      }

      data[idx] = nextItem;
      writeData(collection, data);
      return res.json(data[idx]);
    });

    router.delete(`/${collection}/:id`, requireAuth, (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, 'DELETE');
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
      const forbiddenReason = rentalWriteForbiddenReason(req, 'PUT');
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

      writeData(collection, list);
      return res.json({ ok: true, count: list.length });
    });
  }

  registerRentalCollection('rentals');
  registerRentalCollection('gantt_rentals');

  return router;
}

module.exports = {
  registerRentalRoutes,
};
