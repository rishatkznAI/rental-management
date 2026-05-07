function normalizeEquipmentRef(value) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  if (!normalized || normalized === 'undefined' || normalized === 'null') return '';
  return normalized;
}

function compactRefs(values) {
  return [...new Set((values || []).flat(Infinity).map(normalizeEquipmentRef).filter(Boolean))];
}

function equipmentDisplayName(equipment, fallback = '') {
  if (!equipment) return normalizeEquipmentRef(fallback);
  return [
    equipment.manufacturer,
    equipment.brand,
    equipment.model,
    equipment.name,
    equipment.title,
  ].map(normalizeEquipmentRef).filter(Boolean).join(' ').trim()
    || normalizeEquipmentRef(equipment.inventoryNumber || equipment.equipmentInv || equipment.serialNumber || equipment.id || fallback);
}

function countEquipmentByInventory(equipmentList) {
  const counts = new Map();
  (equipmentList || []).forEach(item => {
    const inventoryNumber = normalizeEquipmentRef(item?.inventoryNumber);
    if (!inventoryNumber) return;
    counts.set(inventoryNumber, (counts.get(inventoryNumber) || 0) + 1);
  });
  return counts;
}

function isUniqueInventoryNumber(inventoryNumber, equipmentList) {
  inventoryNumber = normalizeEquipmentRef(inventoryNumber);
  if (!inventoryNumber) return false;
  const counts = countEquipmentByInventory(equipmentList);
  return (counts.get(inventoryNumber) || 0) === 1;
}

function buildEquipmentLookup(equipmentList = []) {
  const byId = new Map();
  const byInventory = new Map();
  const inventoryCounts = new Map();
  const byEquipmentInv = new Map();
  const equipmentInvCounts = new Map();
  const bySerial = new Map();
  const serialCounts = new Map();

  for (const item of equipmentList || []) {
    const id = normalizeEquipmentRef(item?.id);
    const inventory = normalizeEquipmentRef(item?.inventoryNumber);
    const equipmentInv = normalizeEquipmentRef(item?.equipmentInv || item?.inv);
    const serial = normalizeEquipmentRef(item?.serialNumber);
    if (id) byId.set(id, item);
    if (inventory) {
      if (!byInventory.has(inventory)) byInventory.set(inventory, item);
      inventoryCounts.set(inventory, (inventoryCounts.get(inventory) || 0) + 1);
    }
    if (equipmentInv) {
      if (!byEquipmentInv.has(equipmentInv)) byEquipmentInv.set(equipmentInv, item);
      equipmentInvCounts.set(equipmentInv, (equipmentInvCounts.get(equipmentInv) || 0) + 1);
    }
    if (serial) {
      if (!bySerial.has(serial)) bySerial.set(serial, item);
      serialCounts.set(serial, (serialCounts.get(serial) || 0) + 1);
    }
  }

  return {
    byId,
    byInventory,
    inventoryCounts,
    byEquipmentInv,
    equipmentInvCounts,
    bySerial,
    serialCounts,
  };
}

function lookupUnique(map, counts, ref) {
  if (!ref) return null;
  return (counts.get(ref) || 0) === 1 ? map.get(ref) || null : null;
}

function makeRentalEquipmentResolution({ equipment = null, source = 'unresolved', ref = '', warnings = [] } = {}) {
  return {
    equipmentId: normalizeEquipmentRef(equipment?.id),
    equipment,
    displayName: equipmentDisplayName(equipment, ref),
    inventoryNumber: normalizeEquipmentRef(equipment?.inventoryNumber || equipment?.equipmentInv || ref),
    serialNumber: normalizeEquipmentRef(equipment?.serialNumber),
    source,
    warnings,
  };
}

function resolveRentalEquipment(rental, equipmentList = []) {
  const warnings = [];
  const lookup = buildEquipmentLookup(equipmentList);
  const equipmentId = normalizeEquipmentRef(rental?.equipmentId);

  if (equipmentId) {
    const equipment = lookup.byId.get(equipmentId) || null;
    if (equipment) {
      const legacyRefs = compactRefs([
        rental?.equipmentInv,
        rental?.inventoryNumber,
        rental?.serialNumber,
        ...(Array.isArray(rental?.equipment) ? rental.equipment : []),
      ]);
      for (const ref of legacyRefs) {
        const matchesCanonical = [
          equipment.id,
          equipment.inventoryNumber,
          equipment.equipmentInv,
          equipment.inv,
          equipment.serialNumber,
        ].map(normalizeEquipmentRef).filter(Boolean).includes(ref);
        if (!matchesCanonical) warnings.push(`legacy_ref_mismatch:${ref}`);
      }
      return makeRentalEquipmentResolution({ equipment, source: 'equipmentId', ref: equipmentId, warnings });
    }
    warnings.push(`equipmentId_not_found:${equipmentId}`);
  }

  const scalarRefs = [
    ['equipment.id', rental?.equipmentId],
    ['equipment.inventoryNumber', rental?.equipmentInv],
    ['equipment.inventoryNumber', rental?.inventoryNumber],
    ['equipment.equipmentInv', rental?.equipmentInv],
    ['equipment.equipmentInv', rental?.inventoryNumber],
    ['equipment.serialNumber', rental?.serialNumber],
  ];

  for (const [source, value] of scalarRefs) {
    const ref = normalizeEquipmentRef(value);
    if (!ref) continue;
    if (source === 'equipment.id') {
      const equipment = lookup.byId.get(ref) || null;
      if (equipment) return makeRentalEquipmentResolution({ equipment, source, ref, warnings });
      continue;
    }
    if (source === 'equipment.inventoryNumber') {
      const equipment = lookupUnique(lookup.byInventory, lookup.inventoryCounts, ref);
      if (equipment) return makeRentalEquipmentResolution({ equipment, source, ref, warnings });
      if ((lookup.inventoryCounts.get(ref) || 0) > 1) warnings.push(`ambiguous_inventoryNumber:${ref}`);
      continue;
    }
    if (source === 'equipment.equipmentInv') {
      const equipment = lookupUnique(lookup.byEquipmentInv, lookup.equipmentInvCounts, ref);
      if (equipment) return makeRentalEquipmentResolution({ equipment, source, ref, warnings });
      if ((lookup.equipmentInvCounts.get(ref) || 0) > 1) warnings.push(`ambiguous_equipmentInv:${ref}`);
      continue;
    }
    if (source === 'equipment.serialNumber') {
      const equipment = lookupUnique(lookup.bySerial, lookup.serialCounts, ref);
      if (equipment) return makeRentalEquipmentResolution({ equipment, source, ref, warnings });
      if ((lookup.serialCounts.get(ref) || 0) > 1) warnings.push(`ambiguous_serialNumber:${ref}`);
    }
  }

  const legacyRefs = compactRefs(Array.isArray(rental?.equipment) ? rental.equipment : []);
  for (const ref of legacyRefs) {
    const byId = lookup.byId.get(ref) || null;
    if (byId) return makeRentalEquipmentResolution({ equipment: byId, source: 'legacy.rental.equipment:id', ref, warnings });
    const byInventory = lookupUnique(lookup.byInventory, lookup.inventoryCounts, ref);
    if (byInventory) return makeRentalEquipmentResolution({ equipment: byInventory, source: 'legacy.rental.equipment:inventoryNumber', ref, warnings });
    if ((lookup.inventoryCounts.get(ref) || 0) > 1) warnings.push(`ambiguous_legacy_inventoryNumber:${ref}`);
    const byEquipmentInv = lookupUnique(lookup.byEquipmentInv, lookup.equipmentInvCounts, ref);
    if (byEquipmentInv) return makeRentalEquipmentResolution({ equipment: byEquipmentInv, source: 'legacy.rental.equipment:equipmentInv', ref, warnings });
    const bySerial = lookupUnique(lookup.bySerial, lookup.serialCounts, ref);
    if (bySerial) return makeRentalEquipmentResolution({ equipment: bySerial, source: 'legacy.rental.equipment:serialNumber', ref, warnings });
  }

  return makeRentalEquipmentResolution({ ref: legacyRefs[0] || equipmentId || '', warnings });
}

function findEquipmentForRentalPayload(payload, equipmentList) {
  return resolveRentalEquipment(payload, equipmentList).equipment || null;
}

function rentalMatchesEquipment(rental, equipment, equipmentList) {
  if (!rental || !equipment) return false;
  const resolved = resolveRentalEquipment(rental, equipmentList || [equipment]);
  return Boolean(resolved.equipmentId && normalizeEquipmentRef(resolved.equipmentId) === normalizeEquipmentRef(equipment.id));
}

function equipmentMatchesServiceTicket(ticket, equipment, equipmentList) {
  if (!ticket || !equipment) return false;
  if (ticket.equipmentId && ticket.equipmentId === equipment.id) return true;
  if (ticket.serialNumber && equipment.serialNumber && ticket.serialNumber === equipment.serialNumber) return true;
  return Boolean(
    ticket.inventoryNumber &&
    equipment.inventoryNumber &&
    isUniqueInventoryNumber(ticket.inventoryNumber, equipmentList) &&
    ticket.inventoryNumber === equipment.inventoryNumber
  );
}

module.exports = {
  normalizeEquipmentRef,
  countEquipmentByInventory,
  isUniqueInventoryNumber,
  buildEquipmentLookup,
  resolveRentalEquipment,
  findEquipmentForRentalPayload,
  rentalMatchesEquipment,
  equipmentMatchesServiceTicket,
};
