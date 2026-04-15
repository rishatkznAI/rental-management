function registerServiceRoutes(router, deps) {
  const {
    readData,
    writeData,
    requireAuth,
    requireWrite,
    normalizeServiceWorkRecord,
    normalizeSparePartRecord,
    requireNonEmptyString,
    nowIso,
    generateId,
    idPrefixes,
    findServiceTicketOr404,
    migrateLegacyRepairFacts,
  } = deps;

  router.get('/service_works/active', requireAuth, (req, res) => {
    const list = (readData('service_works') || [])
      .map(normalizeServiceWorkRecord)
      .filter(item => item.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
    res.json(list);
  });

  router.post('/service_works/:id/deactivate', requireAuth, requireWrite('service_works'), (req, res) => {
    const list = readData('service_works') || [];
    const index = list.findIndex(item => item.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: 'Работа не найдена' });
    }
    list[index] = normalizeServiceWorkRecord({
      ...list[index],
      isActive: false,
      id: list[index].id,
      createdAt: list[index].createdAt,
      updatedAt: nowIso(),
    });
    writeData('service_works', list);
    return res.json(list[index]);
  });

  router.get('/spare_parts/active', requireAuth, (req, res) => {
    const list = (readData('spare_parts') || [])
      .map(normalizeSparePartRecord)
      .filter(item => item.isActive)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    res.json(list);
  });

  router.post('/spare_parts/:id/deactivate', requireAuth, requireWrite('spare_parts'), (req, res) => {
    const list = readData('spare_parts') || [];
    const index = list.findIndex(item => item.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: 'Запчасть не найдена' });
    }
    list[index] = normalizeSparePartRecord({
      ...list[index],
      isActive: false,
      id: list[index].id,
      createdAt: list[index].createdAt,
      updatedAt: nowIso(),
    });
    writeData('spare_parts', list);
    return res.json(list[index]);
  });

  router.get('/repair_work_items', requireAuth, (req, res) => {
    const repairId = String(req.query.repair_id || '').trim();
    const list = readData('repair_work_items') || [];
    const catalog = readData('service_works') || [];
    const catalogById = new Map(catalog.map(item => [item.id, item]));
    const sanitized = list.map(item => {
      const ref = catalogById.get(item.workId);
      const normHours = Number.isNaN(item.normHoursSnapshot) || item.normHoursSnapshot == null
        ? (ref ? Math.max(0, Number(ref.normHours) || 0) : 0)
        : Number(item.normHoursSnapshot);
      const ratePerHour = Number.isNaN(item.ratePerHourSnapshot) || item.ratePerHourSnapshot == null
        ? (ref ? Math.max(0, Number(ref.ratePerHour) || 0) : 0)
        : Number(item.ratePerHourSnapshot);
      return {
        ...item,
        normHoursSnapshot: normHours,
        ratePerHourSnapshot: ratePerHour,
        nameSnapshot: item.nameSnapshot || ref?.name || 'Работа',
        quantity: Number.isNaN(item.quantity) || item.quantity == null ? 1 : Number(item.quantity),
      };
    });
    res.json(repairId ? sanitized.filter(item => item.repairId === repairId) : sanitized);
  });

  router.post('/repair_work_items', requireAuth, requireWrite('repair_work_items'), (req, res) => {
    try {
      const { repairId, workId } = req.body || {};
      const quantity = Number(req.body?.quantity);
      requireNonEmptyString(repairId, 'Заявка');
      requireNonEmptyString(workId, 'Работа');
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Количество работы должно быть больше 0');
      }
      if (!findServiceTicketOr404(repairId, res)) return;

      const work = (readData('service_works') || []).find(item => item.id === workId && item.isActive !== false);
      if (!work) {
        return res.status(404).json({ ok: false, error: 'Работа из справочника не найдена или отключена' });
      }

      const list = readData('repair_work_items') || [];
      const item = {
        id: generateId(idPrefixes.repair_work_items),
        repairId,
        workId,
        quantity,
        normHoursSnapshot: Math.max(0, Number(work.normHours) || 0),
        ratePerHourSnapshot: Math.max(0, Number(work.ratePerHour) || 0),
        nameSnapshot: String(work.name || '').trim(),
        categorySnapshot: work.category ? String(work.category).trim() : undefined,
        createdAt: nowIso(),
      };
      list.push(item);
      writeData('repair_work_items', list);
      res.status(201).json(item);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.delete('/repair_work_items/:id', requireAuth, requireWrite('repair_work_items'), (req, res) => {
    const list = readData('repair_work_items') || [];
    const index = list.findIndex(item => item.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: 'Строка работы не найдена' });
    }
    list.splice(index, 1);
    writeData('repair_work_items', list);
    res.json({ ok: true });
  });

  router.get('/repair_part_items', requireAuth, (req, res) => {
    const repairId = String(req.query.repair_id || '').trim();
    const list = readData('repair_part_items') || [];
    const catalog = readData('spare_parts') || [];
    const catalogById = new Map(catalog.map(item => [item.id, item]));
    const sanitized = list.map(item => {
      const ref = catalogById.get(item.partId);
      return {
        ...item,
        nameSnapshot: item.nameSnapshot || ref?.name || 'Запчасть',
        priceSnapshot: Number.isNaN(item.priceSnapshot) || item.priceSnapshot == null
          ? (ref ? Math.max(0, Number(ref.defaultPrice) || 0) : 0)
          : Number(item.priceSnapshot),
        quantity: Number.isNaN(item.quantity) || item.quantity == null ? 1 : Number(item.quantity),
        unitSnapshot: item.unitSnapshot || ref?.unit || 'шт',
      };
    });
    res.json(repairId ? sanitized.filter(item => item.repairId === repairId) : sanitized);
  });

  router.post('/repair_part_items', requireAuth, requireWrite('repair_part_items'), (req, res) => {
    try {
      const { repairId, partId } = req.body || {};
      const quantity = Number(req.body?.quantity);
      const priceSnapshot = Number(req.body?.priceSnapshot);
      requireNonEmptyString(repairId, 'Заявка');
      requireNonEmptyString(partId, 'Запчасть');
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Количество запчастей должно быть больше 0');
      }
      if (!findServiceTicketOr404(repairId, res)) return;

      const part = (readData('spare_parts') || []).find(item => item.id === partId && item.isActive !== false);
      if (!part) {
        return res.status(404).json({ ok: false, error: 'Запчасть из справочника не найдена или отключена' });
      }

      const safePrice = Number.isFinite(priceSnapshot)
        ? Math.max(0, priceSnapshot)
        : Math.max(0, Number(part.defaultPrice) || 0);

      const list = readData('repair_part_items') || [];
      const item = {
        id: generateId(idPrefixes.repair_part_items),
        repairId,
        partId,
        quantity,
        priceSnapshot: safePrice,
        nameSnapshot: String(part.name || '').trim(),
        articleSnapshot: part.article ? String(part.article).trim() : (part.sku ? String(part.sku).trim() : undefined),
        unitSnapshot: String(part.unit || 'шт').trim() || 'шт',
        createdAt: nowIso(),
      };
      list.push(item);
      writeData('repair_part_items', list);
      res.status(201).json(item);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.delete('/repair_part_items/:id', requireAuth, requireWrite('repair_part_items'), (req, res) => {
    const list = readData('repair_part_items') || [];
    const index = list.findIndex(item => item.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: 'Строка запчасти не найдена' });
    }
    list.splice(index, 1);
    writeData('repair_part_items', list);
    res.json({ ok: true });
  });

  router.get('/reports/mechanics-workload', requireAuth, (req, res) => {
    const mechanics = readData('mechanics') || [];
    const tickets = readData('service') || [];
    const equipment = readData('equipment') || [];
    const workItems = readData('repair_work_items') || [];
    const partItems = readData('repair_part_items') || [];

    const ticketMap = new Map(tickets.map(item => [item.id, item]));
    const equipmentMap = new Map(equipment.map(item => [item.id, item]));
    const partsByRepair = new Map();
    for (const part of partItems) {
      const group = partsByRepair.get(part.repairId) || [];
      group.push(part);
      partsByRepair.set(part.repairId, group);
    }

    const rows = workItems.map(item => {
      const ticket = ticketMap.get(item.repairId);
      const eq = ticket?.equipmentId ? equipmentMap.get(ticket.equipmentId) : null;
      const mechanic = ticket?.assignedMechanicId
        ? mechanics.find(entry => entry.id === ticket.assignedMechanicId)
        : null;
      const repairParts = partsByRepair.get(item.repairId) || [];
      const partsCost = repairParts.reduce((sum, part) => sum + (Number(part.priceSnapshot) || 0) * (Number(part.quantity) || 0), 0);
      const partNames = Array.from(new Set(repairParts.map(part => part.nameSnapshot).filter(Boolean)));
      return {
        mechanicId: ticket?.assignedMechanicId || '',
        mechanicName: mechanic?.name || ticket?.assignedMechanicName || ticket?.assignedTo || 'Не назначен',
        repairId: item.repairId,
        repairStatus: ticket?.status || '',
        createdAt: item.createdAt || ticket?.createdAt || '',
        equipmentId: ticket?.equipmentId || '',
        equipmentLabel: ticket?.equipment || [eq?.manufacturer, eq?.model].filter(Boolean).join(' ') || '—',
        equipmentType: eq?.type || ticket?.equipmentType || '',
        equipmentTypeLabel: ticket?.equipmentTypeLabel || ticket?.equipmentType || eq?.type || '',
        inventoryNumber: ticket?.inventoryNumber || eq?.inventoryNumber || '—',
        serialNumber: ticket?.serialNumber || eq?.serialNumber || '—',
        workName: item.nameSnapshot,
        workCategory: item.categorySnapshot || '',
        partNames,
        partNamesLabel: partNames.join(', '),
        quantity: Number(item.quantity) || 0,
        normHours: Number(item.normHoursSnapshot) || 0,
        totalNormHours: (Number(item.quantity) || 0) * (Number(item.normHoursSnapshot) || 0),
        partsCost,
      };
    });

    const summaryMap = new Map();
    for (const row of rows) {
      const key = row.mechanicId || row.mechanicName;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          mechanicId: row.mechanicId,
          mechanicName: row.mechanicName,
          repairsCount: 0,
          worksCount: 0,
          totalNormHours: 0,
          partsCost: 0,
          equipmentIds: new Set(),
        });
      }
      const summary = summaryMap.get(key);
      summary.repairsCount += 1;
      summary.worksCount += row.quantity;
      summary.totalNormHours += row.totalNormHours;
      summary.partsCost += row.partsCost;
      if (row.equipmentId) summary.equipmentIds.add(row.equipmentId);
    }

    const summary = [...summaryMap.values()].map(item => ({
      mechanicId: item.mechanicId,
      mechanicName: item.mechanicName,
      repairsCount: item.repairsCount,
      worksCount: item.worksCount,
      totalNormHours: Number(item.totalNormHours.toFixed(2)),
      partsCost: Number(item.partsCost.toFixed(2)),
      equipmentCount: item.equipmentIds.size,
    })).sort((a, b) => b.totalNormHours - a.totalNormHours);

    res.json({ summary, rows });
  });

  router.post('/admin/migrate-repair-facts', requireAuth, requireWrite('service_works'), (req, res) => {
    const result = migrateLegacyRepairFacts();
    res.json({ ok: true, ...result });
  });
}

module.exports = {
  registerServiceRoutes,
};
