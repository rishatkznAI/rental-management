function registerServiceRoutes(router, deps) {
  const {
    readData,
    writeData,
    requireAuth,
    requireRead,
    requireWrite,
    normalizeServiceWorkRecord,
    normalizeSparePartRecord,
    requireNonEmptyString,
    nowIso,
    generateId,
    idPrefixes,
    findServiceTicketOr404,
    migrateLegacyRepairFacts,
    accessControl,
    auditLog,
  } = deps;
  const requiredAccessMethods = ['filterCollectionByScope', 'assertCanUpdateEntity'];
  const missingAccessMethods = !accessControl
    ? requiredAccessMethods
    : requiredAccessMethods.filter(name => typeof accessControl[name] !== 'function');
  if (missingAccessMethods.length > 0) {
    throw new Error(`Service routes require access-control methods: ${missingAccessMethods.join(', ')}`);
  }

  const SERVICE_SCENARIO_LABELS = {
    repair: 'Ремонт',
    to: 'ТО',
    chto: 'ЧТО',
    pto: 'ПТО',
  };

  const inferServiceKind = ticket => {
    const kind = String(ticket?.serviceKind || '').trim().toLowerCase();
    if (kind === 'to' || kind === 'chto' || kind === 'pto' || kind === 'repair') return kind;
    const reason = String(ticket?.reason || '').trim().toLowerCase();
    if (reason === 'то') return 'to';
    if (reason === 'что') return 'chto';
    if (reason === 'пто') return 'pto';
    return 'repair';
  };

  function safeNonNegativeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
  }

  function safePositiveNumber(value, fallback = 1) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  }

  function parseRequiredPositiveNumber(value, fieldLabel) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error(`${fieldLabel} должно быть числом больше 0`);
    }
    return numeric;
  }

  function parseOptionalNonNegativeNumber(value, fieldLabel, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error(`${fieldLabel} должно быть числом не меньше 0`);
    }
    return numeric;
  }

  router.get('/service_works/active', requireAuth, requireRead('service'), (req, res) => {
    const list = (readData('service_works') || [])
      .map(normalizeServiceWorkRecord)
      .filter(item => item.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
    res.json(accessControl.sanitizeCollectionForRead('service_works', list, req.user));
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

  router.get('/spare_parts/active', requireAuth, requireRead('service'), (req, res) => {
    const list = (readData('spare_parts') || [])
      .map(normalizeSparePartRecord)
      .filter(item => item.isActive)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    res.json(accessControl.sanitizeCollectionForRead('spare_parts', list, req.user));
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

  router.get('/repair_work_items', requireAuth, requireRead('repair_work_items'), (req, res) => {
    const repairId = String(req.query.repair_id || '').trim();
    const list = readData('repair_work_items') || [];
    const catalog = readData('service_works') || [];
    const catalogById = new Map(catalog.map(item => [item.id, item]));
    const sanitized = list.map(item => {
      const ref = catalogById.get(item.workId);
      const normHours = item.normHoursSnapshot == null
        ? safeNonNegativeNumber(ref?.normHours, 0)
        : safeNonNegativeNumber(item.normHoursSnapshot, 0);
      const ratePerHour = item.ratePerHourSnapshot == null
        ? safeNonNegativeNumber(ref?.ratePerHour, 0)
        : safeNonNegativeNumber(item.ratePerHourSnapshot, 0);
      return {
        ...item,
        normHoursSnapshot: normHours,
        ratePerHourSnapshot: ratePerHour,
        nameSnapshot: item.nameSnapshot || ref?.name || 'Работа',
        quantity: safePositiveNumber(item.quantity, 1),
      };
    });
    const scoped = accessControl.filterCollectionByScope('repair_work_items', sanitized, req.user);
    if (repairId) {
      const rows = scoped.filter(item => item.repairId === repairId);
      if (rows.length === 0 && sanitized.some(item => item.repairId === repairId)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      return res.json(accessControl.sanitizeCollectionForRead('repair_work_items', rows, req.user));
    }
    res.json(accessControl.sanitizeCollectionForRead('repair_work_items', scoped, req.user));
  });

  router.post('/repair_work_items', requireAuth, requireWrite('repair_work_items'), (req, res) => {
    try {
      const { repairId, workId } = req.body || {};
      requireNonEmptyString(repairId, 'Заявка');
      requireNonEmptyString(workId, 'Работа');
      const quantity = parseRequiredPositiveNumber(req.body?.quantity, 'Количество работы');
      const ticket = findServiceTicketOr404(repairId, res);
      if (!ticket) return;
      try {
        accessControl.assertCanUpdateEntity('service', ticket, req.user);
      } catch (error) {
        return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
      }

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
        normHoursSnapshot: safeNonNegativeNumber(work.normHours, 0),
        ratePerHourSnapshot: safeNonNegativeNumber(work.ratePerHour, 0),
        nameSnapshot: String(work.name || '').trim(),
        categorySnapshot: work.category ? String(work.category).trim() : undefined,
        createdAt: nowIso(),
      };
      list.push(item);
      writeData('repair_work_items', list);
      auditLog?.(req, {
        action: 'service.work_item.create',
        entityType: 'repair_work_items',
        entityId: item.id,
        after: item,
      });
      res.status(201).json(accessControl.sanitizeEntityForRead('repair_work_items', item, req.user));
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
    const removed = list[index];
    const ticket = (readData('service') || []).find(item => item.id === removed.repairId);
    if (!ticket) return res.status(404).json({ ok: false, error: 'Заявка на ремонт не найдена' });
    try {
      accessControl.assertCanUpdateEntity('service', ticket, req.user);
    } catch (error) {
      return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
    }
    list.splice(index, 1);
    writeData('repair_work_items', list);
    auditLog?.(req, {
      action: 'service.work_item.delete',
      entityType: 'repair_work_items',
      entityId: removed.id,
      before: removed,
    });
    res.json({ ok: true });
  });

  router.get('/repair_part_items', requireAuth, requireRead('repair_part_items'), (req, res) => {
    const repairId = String(req.query.repair_id || '').trim();
    const list = readData('repair_part_items') || [];
    const catalog = readData('spare_parts') || [];
    const catalogById = new Map(catalog.map(item => [item.id, item]));
    const sanitized = list.map(item => {
      const ref = catalogById.get(item.partId);
      return {
        ...item,
        nameSnapshot: item.nameSnapshot || ref?.name || 'Запчасть',
        priceSnapshot: item.priceSnapshot == null
          ? safeNonNegativeNumber(ref?.defaultPrice, 0)
          : safeNonNegativeNumber(item.priceSnapshot, 0),
        quantity: safePositiveNumber(item.quantity, 1),
        unitSnapshot: item.unitSnapshot || ref?.unit || 'шт',
      };
    });
    const scoped = accessControl.filterCollectionByScope('repair_part_items', sanitized, req.user);
    if (repairId) {
      const rows = scoped.filter(item => item.repairId === repairId);
      if (rows.length === 0 && sanitized.some(item => item.repairId === repairId)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      return res.json(accessControl.sanitizeCollectionForRead('repair_part_items', rows, req.user));
    }
    res.json(accessControl.sanitizeCollectionForRead('repair_part_items', scoped, req.user));
  });

  router.post('/repair_part_items', requireAuth, requireWrite('repair_part_items'), (req, res) => {
    try {
      const { repairId, partId } = req.body || {};
      requireNonEmptyString(repairId, 'Заявка');
      requireNonEmptyString(partId, 'Запчасть');
      const quantity = parseRequiredPositiveNumber(req.body?.quantity, 'Количество запчастей');
      const ticket = findServiceTicketOr404(repairId, res);
      if (!ticket) return;
      try {
        accessControl.assertCanUpdateEntity('service', ticket, req.user);
      } catch (error) {
        return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
      }

      const part = (readData('spare_parts') || []).find(item => item.id === partId && item.isActive !== false);
      if (!part) {
        return res.status(404).json({ ok: false, error: 'Запчасть из справочника не найдена или отключена' });
      }

      const safePrice = parseOptionalNonNegativeNumber(
        req.body?.priceSnapshot,
        'Цена запчасти',
        safeNonNegativeNumber(part.defaultPrice, 0),
      );

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
      auditLog?.(req, {
        action: 'service.part_item.create',
        entityType: 'repair_part_items',
        entityId: item.id,
        after: item,
      });
      res.status(201).json(accessControl.sanitizeEntityForRead('repair_part_items', item, req.user));
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
    const removed = list[index];
    const ticket = (readData('service') || []).find(item => item.id === removed.repairId);
    if (!ticket) return res.status(404).json({ ok: false, error: 'Заявка на ремонт не найдена' });
    try {
      accessControl.assertCanUpdateEntity('service', ticket, req.user);
    } catch (error) {
      return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
    }
    list.splice(index, 1);
    writeData('repair_part_items', list);
    auditLog?.(req, {
      action: 'service.part_item.delete',
      entityType: 'repair_part_items',
      entityId: removed.id,
      before: removed,
    });
    res.json({ ok: true });
  });

  router.get('/reports/mechanics-workload', requireAuth, requireRead('reports'), (req, res) => {
    const mechanics = readData('mechanics') || [];
    const tickets = accessControl.filterCollectionByScope('service', readData('service') || [], req.user);
    const equipment = readData('equipment') || [];
    const workItems = accessControl.filterCollectionByScope('repair_work_items', readData('repair_work_items') || [], req.user);
    const partItems = accessControl.filterCollectionByScope('repair_part_items', readData('repair_part_items') || [], req.user);
    const fieldTrips = accessControl.filterCollectionByScope('service_field_trips', readData('service_field_trips') || [], req.user);

    const ticketMap = new Map(tickets.map(item => [item.id, item]));
    const equipmentMap = new Map(equipment.map(item => [item.id, item]));
    const partsByRepair = new Map();
    for (const part of partItems) {
      const group = partsByRepair.get(part.repairId) || [];
      group.push(part);
      partsByRepair.set(part.repairId, group);
    }

    const worksByRepair = new Map();
    for (const item of workItems) {
      const group = worksByRepair.get(item.repairId) || [];
      group.push(item);
      worksByRepair.set(item.repairId, group);
    }

    const repairCostById = new Map();
    const repairNormHoursById = new Map();
    const partNamesByRepair = new Map();
    for (const [repairId, repairParts] of partsByRepair.entries()) {
      repairCostById.set(
        repairId,
        repairParts.reduce((sum, part) => sum + safeNonNegativeNumber(part.priceSnapshot, 0) * safePositiveNumber(part.quantity, 0), 0),
      );
      partNamesByRepair.set(repairId, Array.from(new Set(repairParts.map(part => part.nameSnapshot).filter(Boolean))));
    }

    for (const item of workItems) {
      repairNormHoursById.set(
        item.repairId,
        (repairNormHoursById.get(item.repairId) || 0) + safePositiveNumber(item.quantity, 0) * safeNonNegativeNumber(item.normHoursSnapshot, 0),
      );
    }

    const rows = tickets.flatMap(ticket => {
      const serviceKind = inferServiceKind(ticket);
      const ticketWorks = worksByRepair.get(ticket.id) || [];
      const eq = ticket?.equipmentId ? equipmentMap.get(ticket.equipmentId) : null;
      const mechanic = ticket?.assignedMechanicId
        ? mechanics.find(entry => entry.id === ticket.assignedMechanicId)
        : null;
      const partNames = partNamesByRepair.get(ticket.id) || [];
      const partsCost = repairCostById.get(ticket.id) || 0;
      const baseRow = {
        mechanicId: ticket?.assignedMechanicId || '',
        mechanicName: mechanic?.name || ticket?.assignedMechanicName || ticket?.assignedTo || 'Не назначен',
        repairId: ticket.id,
        serviceKind,
        repairStatus: ticket?.status || '',
        createdAt: ticket?.createdAt || '',
        equipmentId: ticket?.equipmentId || '',
        equipmentLabel: ticket?.equipment || [eq?.manufacturer, eq?.model].filter(Boolean).join(' ') || '—',
        equipmentType: eq?.type || ticket?.equipmentType || '',
        equipmentTypeLabel: ticket?.equipmentTypeLabel || ticket?.equipmentType || eq?.type || '',
        inventoryNumber: ticket?.inventoryNumber || eq?.inventoryNumber || '—',
        serialNumber: ticket?.serialNumber || eq?.serialNumber || '—',
        partNames,
        partNamesLabel: partNames.join(', '),
        partsCost,
      };

      if (ticketWorks.length === 0) {
        return [{
          ...baseRow,
          workName: `${SERVICE_SCENARIO_LABELS[serviceKind]} без детализации`,
          workCategory: SERVICE_SCENARIO_LABELS[serviceKind],
          quantity: 0,
          normHours: 0,
          totalNormHours: 0,
        }];
      }

      return ticketWorks.map(item => ({
        ...baseRow,
        createdAt: item.createdAt || ticket?.createdAt || '',
        workName: item.nameSnapshot,
        workCategory: item.categorySnapshot || '',
        quantity: safePositiveNumber(item.quantity, 0),
        normHours: safeNonNegativeNumber(item.normHoursSnapshot, 0),
        totalNormHours: safePositiveNumber(item.quantity, 0) * safeNonNegativeNumber(item.normHoursSnapshot, 0),
      }));
    });

    const completedFieldTripRows = fieldTrips
      .filter(item => item && item.status === 'completed')
      .map(item => {
        const ticket = ticketMap.get(item.serviceTicketId);
        const eq = item?.equipmentId ? equipmentMap.get(item.equipmentId) : (ticket?.equipmentId ? equipmentMap.get(ticket.equipmentId) : null);
        const serviceKind = ticket ? inferServiceKind(ticket) : 'repair';
        const mechanic = item?.mechanicId
          ? mechanics.find(entry => entry.id === item.mechanicId)
          : null;
        const routeFrom = String(item.routeFrom || '').trim();
        const routeTo = String(item.routeTo || '').trim();
        return {
          id: item.id,
          mechanicId: item?.mechanicId || ticket?.assignedMechanicId || '',
          mechanicName: mechanic?.name || item?.mechanicName || ticket?.assignedMechanicName || ticket?.assignedTo || 'Не назначен',
          repairId: item.serviceTicketId || '',
          serviceKind,
          repairStatus: ticket?.status || '',
          createdAt: item.completedAt || item.startedAt || item.createdAt || '',
          completedAt: item.completedAt || '',
          tripStatus: item.status || 'completed',
          equipmentId: item?.equipmentId || ticket?.equipmentId || '',
          equipmentLabel: item?.equipmentLabel || ticket?.equipment || [eq?.manufacturer, eq?.model].filter(Boolean).join(' ') || '—',
          equipmentType: eq?.type || ticket?.equipmentType || '',
          equipmentTypeLabel: ticket?.equipmentTypeLabel || ticket?.equipmentType || eq?.type || '',
          inventoryNumber: item?.inventoryNumber || ticket?.inventoryNumber || eq?.inventoryNumber || '—',
          serialNumber: ticket?.serialNumber || eq?.serialNumber || '—',
          routeFrom,
          routeTo,
          routeLabel: [routeFrom, routeTo].filter(Boolean).join(' → '),
          distanceKm: safeNonNegativeNumber(item.distanceKm, 0),
          closedNormHours: safeNonNegativeNumber(item.closedNormHours, 0),
          serviceVehicleId: item.serviceVehicleId || null,
        };
      });

    const summaryMap = new Map();
    for (const row of rows) {
      const key = row.mechanicId || row.mechanicName;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          mechanicId: row.mechanicId,
          mechanicName: row.mechanicName,
          repairIds: new Set(),
          worksCount: 0,
          totalNormHours: 0,
          partsCost: 0,
          equipmentIds: new Set(),
          fieldTripCount: 0,
          fieldTripDistanceKm: 0,
          fieldTripNormHours: 0,
        });
      }
      const summary = summaryMap.get(key);
      summary.repairIds.add(row.repairId);
      summary.worksCount += row.quantity;
      summary.totalNormHours += row.totalNormHours;
      if (!summary.equipmentIds.has(`parts:${row.repairId}`)) {
        summary.partsCost += row.partsCost;
        summary.equipmentIds.add(`parts:${row.repairId}`);
      }
      if (row.equipmentId) summary.equipmentIds.add(row.equipmentId);
    }

    for (const trip of completedFieldTripRows) {
      const key = trip.mechanicId || trip.mechanicName;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          mechanicId: trip.mechanicId,
          mechanicName: trip.mechanicName,
          repairIds: new Set(),
          worksCount: 0,
          totalNormHours: 0,
          partsCost: 0,
          equipmentIds: new Set(),
          fieldTripCount: 0,
          fieldTripDistanceKm: 0,
          fieldTripNormHours: 0,
        });
      }
      const summary = summaryMap.get(key);
      summary.fieldTripCount += 1;
      summary.fieldTripDistanceKm += trip.distanceKm;
      summary.fieldTripNormHours += trip.closedNormHours;
      if (trip.equipmentId) summary.equipmentIds.add(trip.equipmentId);
      if (trip.repairId) summary.repairIds.add(trip.repairId);
    }

    const summary = [...summaryMap.values()].map(item => ({
      mechanicId: item.mechanicId,
      mechanicName: item.mechanicName,
      repairsCount: item.repairIds.size,
      worksCount: item.worksCount,
      totalNormHours: Number(item.totalNormHours.toFixed(2)),
      fieldTripCount: item.fieldTripCount,
      fieldTripDistanceKm: Number(item.fieldTripDistanceKm.toFixed(2)),
      fieldTripNormHours: Number(item.fieldTripNormHours.toFixed(2)),
      totalClosedNormHours: Number((item.totalNormHours + item.fieldTripNormHours).toFixed(2)),
      partsCost: Number(item.partsCost.toFixed(2)),
      equipmentCount: [...item.equipmentIds].filter(value => !String(value).startsWith('parts:')).length,
    })).sort((a, b) => b.totalClosedNormHours - a.totalClosedNormHours);

    const repeatFailureMap = new Map();
    for (const ticket of tickets) {
      const serviceKind = inferServiceKind(ticket);
      if (serviceKind !== 'repair') continue;
      const equipmentId = String(ticket.equipmentId || '').trim();
      const reason = String(ticket.reason || '').trim();
      if (!equipmentId || !reason) continue;
      const eq = equipmentMap.get(equipmentId);
      const repairId = ticket.id;
      const partNames = partNamesByRepair.get(repairId) || [];
      const workCategories = Array.from(
        new Set(((worksByRepair.get(repairId) || []).map(item => item.categorySnapshot).filter(Boolean))),
      );
      const mechanicName = (() => {
        const mechanic = ticket?.assignedMechanicId
          ? mechanics.find(entry => entry.id === ticket.assignedMechanicId)
          : null;
        return mechanic?.name || ticket?.assignedMechanicName || ticket?.assignedTo || 'Не назначен';
      })();
      const key = `${equipmentId}::${reason.toLowerCase()}`;
      if (!repeatFailureMap.has(key)) {
        repeatFailureMap.set(key, {
          equipmentId,
          equipmentLabel: ticket?.equipment || [eq?.manufacturer, eq?.model].filter(Boolean).join(' ') || '—',
          equipmentType: eq?.type || ticket?.equipmentType || '',
          equipmentTypeLabel: ticket?.equipmentTypeLabel || ticket?.equipmentType || eq?.type || '',
          inventoryNumber: ticket?.inventoryNumber || eq?.inventoryNumber || '—',
          serialNumber: ticket?.serialNumber || eq?.serialNumber || '—',
          reason,
          serviceKind,
          repairIds: new Set(),
          repairStatuses: new Set(),
          mechanicNames: new Set(),
          partNames: new Set(),
          workCategories: new Set(),
          createdDates: [],
          totalNormHours: 0,
          totalPartsCost: 0,
          firstCreatedAt: ticket.createdAt || '',
          lastCreatedAt: ticket.createdAt || '',
        });
      }
      const item = repeatFailureMap.get(key);
      item.repairIds.add(repairId);
      if (ticket.status) item.repairStatuses.add(ticket.status);
      if (mechanicName) item.mechanicNames.add(mechanicName);
      partNames.forEach(name => item.partNames.add(name));
      workCategories.forEach(category => item.workCategories.add(category));
      if (ticket.createdAt) item.createdDates.push(ticket.createdAt);
      item.totalNormHours += repairNormHoursById.get(repairId) || 0;
      item.totalPartsCost += repairCostById.get(repairId) || 0;
      if (ticket.createdAt && (!item.firstCreatedAt || ticket.createdAt < item.firstCreatedAt)) item.firstCreatedAt = ticket.createdAt;
      if (ticket.createdAt && (!item.lastCreatedAt || ticket.createdAt > item.lastCreatedAt)) item.lastCreatedAt = ticket.createdAt;
    }

    const repeatFailures = [...repeatFailureMap.values()]
      .map(item => ({
        equipmentId: item.equipmentId,
        equipmentLabel: item.equipmentLabel,
        equipmentType: item.equipmentType,
        equipmentTypeLabel: item.equipmentTypeLabel,
        inventoryNumber: item.inventoryNumber,
        serialNumber: item.serialNumber,
        reason: item.reason,
        serviceKind: item.serviceKind,
        repairsCount: item.repairIds.size,
        totalNormHours: Number(item.totalNormHours.toFixed(2)),
        totalPartsCost: Number(item.totalPartsCost.toFixed(2)),
        firstCreatedAt: item.firstCreatedAt,
        lastCreatedAt: item.lastCreatedAt,
        repairIds: [...item.repairIds],
        repairStatuses: [...item.repairStatuses],
        mechanicNames: [...item.mechanicNames],
        partNames: [...item.partNames],
        workCategories: [...item.workCategories],
        createdDates: item.createdDates,
      }))
      .filter(item => item.repairsCount >= 2)
      .sort((a, b) => b.repairsCount - a.repairsCount || b.totalNormHours - a.totalNormHours || String(b.lastCreatedAt).localeCompare(String(a.lastCreatedAt)));

    res.json({ summary, rows, fieldTrips: completedFieldTripRows, repeatFailures });
  });

  router.post('/admin/migrate-repair-facts', requireAuth, requireWrite('service_works'), (req, res) => {
    const result = migrateLegacyRepairFacts();
    res.json({ ok: true, ...result });
  });
}

module.exports = {
  registerServiceRoutes,
};
