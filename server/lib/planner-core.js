const { resolveRentalEquipment } = require('./equipment-matching');

function sameText(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function compact(values) {
  return values.flat(Infinity).filter(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function rentalEquipmentRefs(rental) {
  const equipmentList = Array.isArray(rental?.equipment) ? rental.equipment : [];
  const equipmentIds = Array.isArray(rental?.equipmentIds) ? rental.equipmentIds : [];
  return compact([
    rental?.equipmentId,
    rental?.equipmentInv,
    rental?.inventoryNumber,
    rental?.serialNumber,
    equipmentIds,
    equipmentList.map(item => typeof item === 'object'
      ? [item.id, item.equipmentId, item.inventoryNumber, item.serialNumber, item.inv]
      : item),
  ]);
}

function equipmentMatchesRef(equipment, ref) {
  return compact([
    equipment?.id,
    equipment?.equipmentId,
    equipment?.inventoryNumber,
    equipment?.serialNumber,
    equipment?.inv,
  ]).some(value => sameText(value, ref));
}

function rentalHasEquipmentRef(rental, equipmentRef, eqById, eqByInv) {
  const refs = rentalEquipmentRefs(rental);
  if (refs.some(ref => sameText(ref, equipmentRef))) return true;
  return refs.some(ref => {
    const eq = eqById.get(ref) || eqByInv.get(ref);
    return eq && equipmentMatchesRef(eq, equipmentRef);
  });
}

function splitPlannerRowId(rowId) {
  if (!rowId || !String(rowId).includes('__')) return null;
  const [sourceId, ...refParts] = String(rowId).split('__');
  const equipmentRef = refParts.join('__');
  if (!sourceId || !equipmentRef) return null;
  return { sourceId, equipmentRef };
}

function resolvePlannerRowSource(rowId, collections) {
  const parsed = splitPlannerRowId(rowId);
  if (!parsed) return null;

  const rentals = Array.isArray(collections?.rentals) ? collections.rentals : [];
  const deliveries = Array.isArray(collections?.deliveries) ? collections.deliveries : [];
  const serviceTickets = Array.isArray(collections?.serviceTickets) ? collections.serviceTickets : [];
  const equipment = Array.isArray(collections?.equipment) ? collections.equipment : [];
  const eqByInv = new Map(equipment.map(item => [item.inventoryNumber, item]));
  const eqById = new Map(equipment.map(item => [item.id, item]));

  if (parsed.sourceId.startsWith('delivery:')) {
    const id = parsed.sourceId.slice('delivery:'.length);
    const delivery = deliveries.find(item => String(item?.id || '') === id);
    if (!delivery) return null;
    const eq = delivery.equipmentId
      ? eqById.get(delivery.equipmentId) || null
      : (delivery.equipmentInv ? eqByInv.get(delivery.equipmentInv) || null : null);
    const expectedRef = eq?.inventoryNumber || delivery.equipmentInv || delivery.cargo || delivery.id;
    if (!sameText(expectedRef, parsed.equipmentRef)) return null;
    return { collection: 'deliveries', entity: delivery, sourceId: parsed.sourceId, equipmentRef: parsed.equipmentRef };
  }

  if (parsed.sourceId.startsWith('service:')) {
    const id = parsed.sourceId.slice('service:'.length);
    const ticket = serviceTickets.find(item => String(item?.id || '') === id);
    if (!ticket) return null;
    const eq = ticket.equipmentId
      ? eqById.get(ticket.equipmentId) || null
      : (ticket.inventoryNumber ? eqByInv.get(ticket.inventoryNumber) || null : null);
    const expectedRef = eq?.inventoryNumber || ticket.inventoryNumber || ticket.equipmentId || ticket.id;
    if (!sameText(expectedRef, parsed.equipmentRef)) return null;
    return { collection: 'service', entity: ticket, sourceId: parsed.sourceId, equipmentRef: parsed.equipmentRef };
  }

  const rental = rentals.find(item => String(item?.id || '') === parsed.sourceId);
  if (!rental) return null;
  const resolved = resolveRentalEquipment(rental, equipment);
  if (resolved.equipment) {
    const expectedRefs = compact([
      resolved.equipment.id,
      resolved.equipment.inventoryNumber,
      resolved.equipment.equipmentInv,
      resolved.equipment.serialNumber,
    ]);
    if (!expectedRefs.some(ref => sameText(ref, parsed.equipmentRef))) return null;
  } else if (!rentalHasEquipmentRef(rental, parsed.equipmentRef, eqById, eqByInv)) {
    return null;
  }
  return { collection: 'rentals', entity: rental, sourceId: parsed.sourceId, equipmentRef: parsed.equipmentRef };
}

function readScopedPlannerCollections({ readData, accessControl, user }) {
  const rawCollections = readPlannerCollections({ readData });
  const equipment = accessControl.filterCollectionByScope('equipment', rawCollections.equipment, user);
  return {
    rentals: accessControl.filterCollectionByScope('rentals', rawCollections.rentals, user),
    deliveries: accessControl.filterCollectionByScope('deliveries', rawCollections.deliveries, user),
    serviceTickets: accessControl.filterCollectionByScope('service', rawCollections.serviceTickets, user),
    equipment,
    plannerItems: rawCollections.plannerItems.filter(item => {
      const source = resolvePlannerRowSource(`${item?.rentalId || ''}__${item?.equipmentRef || ''}`, rawCollections);
      return source && accessControl.canAccessEntity(source.collection, source.entity, user);
    }),
  };
}

function readPlannerCollections({ readData }) {
  return {
    rentals: readData('rentals') || [],
    deliveries: readData('deliveries') || [],
    serviceTickets: readData('service') || [],
    equipment: readData('equipment') || [],
    plannerItems: readData('planner_items') || [],
  };
}

function buildPlannerRows(collections, options = {}) {
  const includeShipped = options.includeShipped === true;
  const rentals = Array.isArray(collections?.rentals) ? collections.rentals : [];
  const deliveries = Array.isArray(collections?.deliveries) ? collections.deliveries : [];
  const serviceTickets = Array.isArray(collections?.serviceTickets) ? collections.serviceTickets : [];
  const equipment = Array.isArray(collections?.equipment) ? collections.equipment : [];
  const plannerItems = Array.isArray(collections?.plannerItems) ? collections.plannerItems : [];

  const eqByInv = new Map(equipment.map(e => [e.inventoryNumber, e]));
  const eqById = new Map(equipment.map(e => [e.id, e]));
  const overlayMap = new Map(plannerItems.map(p => [`${p.rentalId}__${p.equipmentRef}`, p]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = [];

  for (const rental of rentals) {
    if (rental.status === 'closed') continue;
    if (!rental.startDate) continue;

    const resolvedEquipment = resolveRentalEquipment(rental, equipment);
    const equipmentRefs = resolvedEquipment.equipment
      ? [resolvedEquipment.inventoryNumber || resolvedEquipment.equipmentId]
      : (Array.isArray(rental.equipment) ? rental.equipment : []);
    if (equipmentRefs.length === 0) continue;

    const startDate = new Date(rental.startDate);
    startDate.setHours(0, 0, 0, 0);
    const daysUntil = Math.round((startDate - today) / (1000 * 60 * 60 * 24));

    for (const ref of equipmentRefs) {
      if (!ref) continue;

      const eq = resolvedEquipment.equipment || eqById.get(ref) || eqByInv.get(ref) || null;
      const equipmentRef = eq ? (eq.inventoryNumber || ref) : ref;
      const rowId = `${rental.id}__${equipmentRef}`;
      const overlay = overlayMap.get(rowId) || null;
      const prepStatus = overlay?.prepStatus || 'planned';

      if (!includeShipped && prepStatus === 'shipped') continue;

      let autoPriority;
      if (daysUntil <= 1) autoPriority = 'high';
      else if (daysUntil <= 3) autoPriority = 'medium';
      else autoPriority = 'low';

      const isReadyOrShipped = prepStatus === 'ready' || prepStatus === 'shipped';
      if (isReadyOrShipped && daysUntil <= 1) autoPriority = 'medium';

      const priority = overlay?.priorityOverride || autoPriority;
      const isInRepair = eq?.status === 'in_service';
      const autoRisk = (
        (daysUntil <= 2 && !isReadyOrShipped) ||
        isInRepair ||
        (daysUntil < 0 && !isReadyOrShipped)
      );
      const risk = overlay?.riskOverride !== null && overlay?.riskOverride !== undefined
        ? overlay.riskOverride
        : autoRisk;

      rows.push({
        id: rowId,
        rentalId: rental.id,
        equipmentId: eq?.id || null,
        equipmentRef,
        startDate: rental.startDate,
        daysUntil,
        equipmentLabel: eq ? `${eq.manufacturer || ''} ${eq.model || ''}`.trim() : ref,
        inventoryNumber: eq?.inventoryNumber || ref,
        serialNumber: eq?.serialNumber || null,
        equipmentType: eq?.type || null,
        client: rental.client || '',
        deliveryAddress: rental.deliveryAddress || '',
        manager: rental.manager || '',
        equipmentStatus: eq?.status || null,
        prepStatus,
        priority,
        risk,
        comment: overlay?.comment || '',
        rentalStatus: rental.status,
        sourceType: 'rental',
        operationType: 'rental',
      });
    }
  }

  for (const delivery of deliveries) {
    if (!delivery.transportDate) continue;
    if (delivery.status === 'cancelled') continue;

    const eq = delivery.equipmentId
      ? eqById.get(delivery.equipmentId) || null
      : (delivery.equipmentInv ? eqByInv.get(delivery.equipmentInv) || null : null);
    const equipmentRef = eq?.inventoryNumber || delivery.equipmentInv || delivery.cargo || delivery.id;
    const rowId = `delivery:${delivery.id}__${equipmentRef}`;
    const overlay = overlayMap.get(rowId) || null;

    const startDate = new Date(delivery.transportDate);
    startDate.setHours(0, 0, 0, 0);
    const daysUntil = Math.round((startDate - today) / (1000 * 60 * 60 * 24));

    let autoPriority;
    if (daysUntil <= 1) autoPriority = 'high';
    else if (daysUntil <= 3) autoPriority = 'medium';
    else autoPriority = 'low';

    const isCompleted = delivery.status === 'completed';
    const autoRisk = !isCompleted && daysUntil <= 1;
    const priority = overlay?.priorityOverride || autoPriority;
    const risk = overlay?.riskOverride !== null && overlay?.riskOverride !== undefined
      ? overlay.riskOverride
      : autoRisk;

    const defaultPrepStatus = isCompleted
      ? (delivery.type === 'shipping' ? 'shipped' : 'ready')
      : (delivery.type === 'shipping' ? 'planned' : 'inspection');
    const prepStatus = overlay?.prepStatus || defaultPrepStatus;

    if (!includeShipped && prepStatus === 'shipped') continue;

    rows.push({
      id: rowId,
      rentalId: `delivery:${delivery.id}`,
      equipmentId: eq?.id || delivery.equipmentId || null,
      equipmentRef,
      startDate: delivery.transportDate,
      daysUntil,
      equipmentLabel: delivery.equipmentLabel || (eq ? `${eq.manufacturer || ''} ${eq.model || ''}`.trim() : delivery.cargo),
      inventoryNumber: equipmentRef,
      serialNumber: eq?.serialNumber || null,
      equipmentType: eq?.type || null,
      client: delivery.client || '',
      deliveryAddress: `${delivery.origin} → ${delivery.destination}`,
      manager: delivery.manager || '',
      equipmentStatus: eq?.status || null,
      prepStatus,
      priority,
      risk,
      comment: overlay?.comment || `${delivery.type === 'shipping' ? 'Отгрузка' : 'Приёмка'} · ${delivery.cargo}`,
      rentalStatus: delivery.type === 'shipping' ? 'delivery' : 'return_planned',
      sourceType: 'delivery',
      operationType: delivery.type,
    });
  }

  for (const ticket of serviceTickets) {
    if (!ticket?.plannedDate) continue;
    if (ticket.status === 'closed') continue;

    const eq = ticket.equipmentId
      ? eqById.get(ticket.equipmentId) || null
      : (ticket.inventoryNumber ? eqByInv.get(ticket.inventoryNumber) || null : null);
    const equipmentRef = eq?.inventoryNumber || ticket.inventoryNumber || ticket.equipmentId || ticket.id;
    const rowId = `service:${ticket.id}__${equipmentRef}`;
    const overlay = overlayMap.get(rowId) || null;

    const startDate = new Date(ticket.plannedDate);
    startDate.setHours(0, 0, 0, 0);
    const daysUntil = Math.round((startDate - today) / (1000 * 60 * 60 * 24));

    const servicePriority = ticket.priority === 'critical' || ticket.priority === 'high'
      ? 'high'
      : ticket.priority === 'medium'
        ? 'medium'
        : 'low';
    const timePriority = daysUntil <= 1 ? 'high' : daysUntil <= 3 ? 'medium' : 'low';
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    const autoPriority = priorityOrder[servicePriority] >= priorityOrder[timePriority]
      ? servicePriority
      : timePriority;
    const priority = overlay?.priorityOverride || autoPriority;

    const defaultPrepStatus =
      ticket.status === 'ready' ? 'ready'
      : ticket.status === 'waiting_parts' ? 'on_hold'
      : ticket.status === 'in_progress' ? 'in_repair'
      : 'planned';

    const prepStatus = overlay?.prepStatus || defaultPrepStatus;
    if (!includeShipped && prepStatus === 'shipped') continue;

    const isReady = prepStatus === 'ready';
    const autoRisk =
      ticket.status === 'waiting_parts' ||
      (daysUntil <= 1 && !isReady) ||
      (daysUntil < 0 && !isReady);
    const risk = overlay?.riskOverride !== null && overlay?.riskOverride !== undefined
      ? overlay.riskOverride
      : autoRisk;

    const serviceLabel = ticket.serviceKind
      ? String(ticket.serviceKind).trim().toUpperCase()
      : 'Сервис';
    const reason = String(ticket.reason || '').trim();
    const description = String(ticket.description || '').trim();
    const workTitle = reason || description || 'Запланированная работа';
    const comment = overlay?.comment || [ticket.id, workTitle].filter(Boolean).join(' · ');

    rows.push({
      id: rowId,
      rentalId: `service:${ticket.id}`,
      equipmentId: eq?.id || ticket.equipmentId || null,
      equipmentRef,
      startDate: ticket.plannedDate,
      daysUntil,
      equipmentLabel: ticket.equipment || (eq ? `${eq.manufacturer || ''} ${eq.model || ''}`.trim() : equipmentRef),
      inventoryNumber: eq?.inventoryNumber || ticket.inventoryNumber || equipmentRef,
      serialNumber: ticket.serialNumber || eq?.serialNumber || null,
      equipmentType: eq?.type || null,
      client: `${serviceLabel} · ${workTitle}`,
      deliveryAddress: description && description !== reason ? description : (ticket.location || ''),
      manager: ticket.assignedMechanicName || ticket.assignedTo || ticket.createdByUserName || ticket.createdBy || '',
      equipmentStatus: eq?.status || (ticket.status === 'in_progress' || ticket.status === 'waiting_parts' ? 'in_service' : null),
      prepStatus,
      priority,
      risk,
      comment,
      rentalStatus: 'new',
      sourceType: 'service',
      operationType: 'service',
    });
  }

  const rowPriorityOrder = { high: 0, medium: 1, low: 2 };
  rows.sort((a, b) => {
    const dateDiff = new Date(a.startDate) - new Date(b.startDate);
    if (dateDiff !== 0) return dateDiff;
    return (rowPriorityOrder[a.priority] ?? 99) - (rowPriorityOrder[b.priority] ?? 99);
  });

  return rows;
}

module.exports = {
  buildPlannerRows,
  readPlannerCollections,
  readScopedPlannerCollections,
  resolvePlannerRowSource,
  splitPlannerRowId,
};
