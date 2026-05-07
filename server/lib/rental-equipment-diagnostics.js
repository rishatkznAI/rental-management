const {
  normalizeEquipmentRef,
  resolveRentalEquipment,
} = require('./equipment-matching');

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function ganttRentalLinkIds(ganttRental) {
  return [
    ganttRental?.rentalId,
    ganttRental?.sourceRentalId,
    ganttRental?.originalRentalId,
    ganttRental?.classicRentalId,
    ganttRental?.entityId,
    ganttRental?.approvalEntityId,
  ].map(normalizeEquipmentRef).filter(Boolean);
}

function equipmentIdentity(equipment) {
  if (!equipment) return null;
  return {
    id: normalizeEquipmentRef(equipment.id),
    inventoryNumber: normalizeEquipmentRef(equipment.inventoryNumber || equipment.equipmentInv || equipment.inv),
    serialNumber: normalizeEquipmentRef(equipment.serialNumber),
  };
}

function duplicateGroups(equipmentList, field, aliases = [field]) {
  const groups = new Map();
  for (const equipment of equipmentList) {
    const value = normalizeEquipmentRef(aliases.map(key => equipment?.[key]).find(Boolean));
    if (!value) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(equipment);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([value, items]) => ({
      type: field,
      value,
      count: items.length,
      equipmentIds: items.map(item => normalizeEquipmentRef(item.id)).filter(Boolean),
    }));
}

function canonicalRefs(equipment) {
  return [
    equipment?.id,
    equipment?.inventoryNumber,
    equipment?.equipmentInv,
    equipment?.inv,
    equipment?.serialNumber,
  ].map(normalizeEquipmentRef).filter(Boolean);
}

function legacyRefs(record) {
  return [
    record?.equipmentInv,
    record?.inventoryNumber,
    record?.serialNumber,
    ...(Array.isArray(record?.equipment) ? record.equipment : []),
  ].map(normalizeEquipmentRef).filter(Boolean);
}

function findLegacyConflicts(record, resolved, equipmentList) {
  if (!normalizeEquipmentRef(record?.equipmentId) || !resolved?.equipment) return [];
  const canonical = new Set(canonicalRefs(resolved.equipment));
  const conflicts = [];
  for (const ref of [...new Set(legacyRefs(record))]) {
    if (!ref || canonical.has(ref)) continue;
    const legacyResolved = resolveRentalEquipment({ equipmentInv: ref, inventoryNumber: ref, serialNumber: ref, equipment: [ref] }, equipmentList);
    conflicts.push({
      ref,
      resolvedEquipmentId: legacyResolved.equipmentId || '',
      resolvedInventoryNumber: legacyResolved.inventoryNumber || ref,
      source: legacyResolved.source,
    });
  }
  return conflicts;
}

function rentalIssue(record, resolved, extra = {}) {
  return {
    id: normalizeEquipmentRef(record?.id),
    rentalId: normalizeEquipmentRef(record?.rentalId),
    equipmentId: normalizeEquipmentRef(record?.equipmentId),
    equipmentInv: normalizeEquipmentRef(record?.equipmentInv || record?.inventoryNumber),
    resolvedEquipmentId: resolved?.equipmentId || '',
    resolvedInventoryNumber: resolved?.inventoryNumber || '',
    source: resolved?.source || 'unresolved',
    warnings: resolved?.warnings || [],
    ...extra,
  };
}

function ganttIssue(ganttRental, rental, ganttResolved, rentalResolved, extra = {}) {
  return {
    id: normalizeEquipmentRef(ganttRental?.id),
    rentalId: normalizeEquipmentRef(ganttRental?.rentalId),
    linkedRentalId: normalizeEquipmentRef(rental?.id),
    equipmentId: normalizeEquipmentRef(ganttRental?.equipmentId),
    equipmentInv: normalizeEquipmentRef(ganttRental?.equipmentInv || ganttRental?.inventoryNumber),
    resolvedEquipmentId: ganttResolved?.equipmentId || '',
    canonicalRentalEquipmentId: rentalResolved?.equipmentId || '',
    canonicalRentalInventoryNumber: rentalResolved?.inventoryNumber || '',
    source: ganttResolved?.source || 'unresolved',
    warnings: ganttResolved?.warnings || [],
    ...extra,
  };
}

function analyzeRentalEquipmentDiagnostics({ equipment = [], rentals = [], ganttRentals = [] } = {}) {
  const equipmentList = list(equipment);
  const rentalList = list(rentals);
  const ganttList = list(ganttRentals);
  const rentalsById = new Map(rentalList.map(item => [normalizeEquipmentRef(item.id), item]).filter(([id]) => id));

  const issues = {
    rentalsWithoutEquipmentId: [],
    rentalsWithMissingEquipment: [],
    ganttWithoutRentalId: [],
    ganttMissingRental: [],
    ganttEquipmentMismatches: [],
    duplicateEquipmentIdentifiers: [],
    legacyConflicts: [],
  };

  const duplicateEquipmentInv = duplicateGroups(equipmentList, 'equipmentInv', ['equipmentInv', 'inv']);
  const duplicateInventoryNumbers = duplicateGroups(equipmentList, 'inventoryNumber');
  const duplicateSerialNumbers = duplicateGroups(equipmentList, 'serialNumber');
  issues.duplicateEquipmentIdentifiers.push(
    ...duplicateEquipmentInv,
    ...duplicateInventoryNumbers,
    ...duplicateSerialNumbers,
  );

  for (const rental of rentalList) {
    const resolved = resolveRentalEquipment(rental, equipmentList);
    if (!normalizeEquipmentRef(rental.equipmentId)) {
      issues.rentalsWithoutEquipmentId.push(rentalIssue(rental, resolved));
    } else if (!resolved.equipment) {
      issues.rentalsWithMissingEquipment.push(rentalIssue(rental, resolved));
    }

    const conflicts = findLegacyConflicts(rental, resolved, equipmentList);
    if (conflicts.length > 0) {
      issues.legacyConflicts.push(rentalIssue(rental, resolved, {
        entityType: 'rental',
        conflicts,
      }));
    }
  }

  for (const ganttRental of ganttList) {
    const linkedIds = ganttRentalLinkIds(ganttRental);
    const linkedRental = linkedIds.map(id => rentalsById.get(id)).find(Boolean) || null;
    const ganttResolved = resolveRentalEquipment(ganttRental, equipmentList);
    const rentalResolved = linkedRental ? resolveRentalEquipment(linkedRental, equipmentList) : null;

    if (linkedIds.length === 0) {
      issues.ganttWithoutRentalId.push(ganttIssue(ganttRental, null, ganttResolved, null));
    } else if (!linkedRental) {
      issues.ganttMissingRental.push(ganttIssue(ganttRental, null, ganttResolved, null, {
        linkedIds,
      }));
    }

    if (linkedRental && rentalResolved?.equipmentId) {
      const mismatch = ganttResolved.equipmentId && ganttResolved.equipmentId !== rentalResolved.equipmentId;
      const staleGanttId = normalizeEquipmentRef(ganttRental.equipmentId)
        && normalizeEquipmentRef(ganttRental.equipmentId) !== rentalResolved.equipmentId;
      if (mismatch || staleGanttId) {
        issues.ganttEquipmentMismatches.push(ganttIssue(ganttRental, linkedRental, ganttResolved, rentalResolved, {
          reason: staleGanttId ? 'stale_gantt_equipmentId' : 'resolved_equipment_mismatch',
        }));
      }
    }

    const conflicts = findLegacyConflicts(ganttRental, ganttResolved, equipmentList);
    if (conflicts.length > 0) {
      issues.legacyConflicts.push(ganttIssue(ganttRental, linkedRental, ganttResolved, rentalResolved, {
        entityType: 'gantt_rental',
        conflicts,
      }));
    }
  }

  return {
    summary: {
      rentalsTotal: rentalList.length,
      rentalsWithoutEquipmentId: issues.rentalsWithoutEquipmentId.length,
      rentalsWithMissingEquipment: issues.rentalsWithMissingEquipment.length,
      ganttTotal: ganttList.length,
      ganttWithoutRentalId: issues.ganttWithoutRentalId.length,
      ganttMissingRental: issues.ganttMissingRental.length,
      ganttEquipmentMismatches: issues.ganttEquipmentMismatches.length,
      duplicateEquipmentInv: duplicateEquipmentInv.length,
      duplicateInventoryNumbers: duplicateInventoryNumbers.length,
      duplicateSerialNumbers: duplicateSerialNumbers.length,
      legacyConflicts: issues.legacyConflicts.length,
    },
    issues,
  };
}

function canonicalEquipmentFields(equipment) {
  const inventoryNumber = normalizeEquipmentRef(equipment?.inventoryNumber || equipment?.equipmentInv || equipment?.inv);
  return {
    equipmentId: normalizeEquipmentRef(equipment?.id),
    equipmentInv: inventoryNumber,
    inventoryNumber,
    serialNumber: normalizeEquipmentRef(equipment?.serialNumber),
    equipment: inventoryNumber ? [inventoryNumber] : [],
  };
}

function compactChange(change) {
  return Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined));
}

function planRentalEquipmentBackfill({ equipment = [], rentals = [], ganttRentals = [], maxChanges = 200 } = {}) {
  const equipmentList = list(equipment);
  const rentalList = list(rentals);
  const ganttList = list(ganttRentals);
  const rentalsById = new Map(rentalList.map(item => [normalizeEquipmentRef(item.id), item]).filter(([id]) => id));
  const changes = [];
  const manualReview = [];
  const nextRentals = rentalList.map(rental => ({ ...rental }));
  const nextGanttRentals = ganttList.map(ganttRental => ({ ...ganttRental }));
  let rentalsUpdated = 0;
  let ganttUpdated = 0;
  let skipped = 0;

  function pushChange(change) {
    if (changes.length < maxChanges) changes.push(compactChange(change));
  }

  function skip(reason, item) {
    skipped += 1;
    if (manualReview.length < maxChanges) manualReview.push(compactChange({ reason, ...item }));
  }

  for (let index = 0; index < nextRentals.length; index += 1) {
    const rental = nextRentals[index];
    const resolved = resolveRentalEquipment(rental, equipmentList);
    if (!resolved.equipment) {
      skip('equipment_unresolved', {
        collection: 'rentals',
        id: normalizeEquipmentRef(rental.id),
        equipmentId: normalizeEquipmentRef(rental.equipmentId),
        equipmentInv: normalizeEquipmentRef(rental.equipmentInv || rental.inventoryNumber),
        source: resolved.source,
        warnings: resolved.warnings,
      });
      continue;
    }

    const fields = canonicalEquipmentFields(resolved.equipment);
    const hasEquipmentId = Boolean(normalizeEquipmentRef(rental.equipmentId));
    const conflicts = findLegacyConflicts(rental, resolved, equipmentList);
    const shouldBackfillId = !hasEquipmentId && fields.equipmentId;
    const shouldRepairSnapshot = hasEquipmentId && conflicts.length > 0 && resolved.source === 'equipmentId';
    if (!shouldBackfillId && !shouldRepairSnapshot) {
      if (hasEquipmentId && resolved.source !== 'equipmentId') {
        skip('non_empty_equipmentId_not_repaired_from_fallback', {
          collection: 'rentals',
          id: normalizeEquipmentRef(rental.id),
          equipmentId: normalizeEquipmentRef(rental.equipmentId),
          resolvedEquipmentId: resolved.equipmentId,
          source: resolved.source,
          warnings: resolved.warnings,
        });
      }
      continue;
    }

    const before = {
      equipmentId: normalizeEquipmentRef(rental.equipmentId),
      equipmentInv: normalizeEquipmentRef(rental.equipmentInv || rental.inventoryNumber),
      serialNumber: normalizeEquipmentRef(rental.serialNumber),
      equipment: Array.isArray(rental.equipment) ? rental.equipment : [],
    };
    nextRentals[index] = {
      ...rental,
      equipmentId: fields.equipmentId,
      equipmentInv: fields.equipmentInv,
      inventoryNumber: fields.inventoryNumber,
      serialNumber: fields.serialNumber || rental.serialNumber || '',
      equipment: fields.equipment.length ? fields.equipment : (Array.isArray(rental.equipment) ? rental.equipment : []),
    };
    rentalsUpdated += 1;
    pushChange({
      collection: 'rentals',
      id: normalizeEquipmentRef(rental.id),
      action: shouldBackfillId ? 'backfill_equipmentId' : 'repair_legacy_snapshot',
      before,
      after: {
        equipmentId: fields.equipmentId,
        equipmentInv: fields.equipmentInv,
        serialNumber: fields.serialNumber,
        equipment: fields.equipment,
      },
      source: resolved.source,
      warnings: resolved.warnings,
    });
  }

  for (let index = 0; index < nextGanttRentals.length; index += 1) {
    const ganttRental = nextGanttRentals[index];
    const linkedIds = ganttRentalLinkIds(ganttRental);
    const linkedRental = linkedIds.map(id => rentalsById.get(id)).find(Boolean) || null;
    if (!linkedRental) {
      skip('linked_rental_missing', {
        collection: 'gantt_rentals',
        id: normalizeEquipmentRef(ganttRental.id),
        linkedIds,
      });
      continue;
    }
    const rentalResolved = resolveRentalEquipment(linkedRental, equipmentList);
    if (!rentalResolved.equipment) {
      skip('linked_rental_equipment_unresolved', {
        collection: 'gantt_rentals',
        id: normalizeEquipmentRef(ganttRental.id),
        linkedRentalId: normalizeEquipmentRef(linkedRental.id),
        equipmentId: normalizeEquipmentRef(linkedRental.equipmentId),
        equipmentInv: normalizeEquipmentRef(linkedRental.equipmentInv || linkedRental.inventoryNumber),
        source: rentalResolved.source,
        warnings: rentalResolved.warnings,
      });
      continue;
    }
    if (normalizeEquipmentRef(linkedRental.equipmentId) && rentalResolved.source !== 'equipmentId') {
      skip('linked_rental_has_non_empty_equipmentId_not_synced_from_fallback', {
        collection: 'gantt_rentals',
        id: normalizeEquipmentRef(ganttRental.id),
        linkedRentalId: normalizeEquipmentRef(linkedRental.id),
        equipmentId: normalizeEquipmentRef(linkedRental.equipmentId),
        resolvedEquipmentId: rentalResolved.equipmentId,
        source: rentalResolved.source,
        warnings: rentalResolved.warnings,
      });
      continue;
    }
    const fields = canonicalEquipmentFields(rentalResolved.equipment);
    const before = {
      rentalId: normalizeEquipmentRef(ganttRental.rentalId),
      equipmentId: normalizeEquipmentRef(ganttRental.equipmentId),
      equipmentInv: normalizeEquipmentRef(ganttRental.equipmentInv || ganttRental.inventoryNumber),
      serialNumber: normalizeEquipmentRef(ganttRental.serialNumber),
      equipment: Array.isArray(ganttRental.equipment) ? ganttRental.equipment : [],
    };
    const needsUpdate =
      before.rentalId !== normalizeEquipmentRef(linkedRental.id) ||
      before.equipmentId !== fields.equipmentId ||
      before.equipmentInv !== fields.equipmentInv ||
      normalizeEquipmentRef(ganttRental.inventoryNumber) !== fields.inventoryNumber ||
      normalizeEquipmentRef(ganttRental.serialNumber) !== fields.serialNumber ||
      JSON.stringify(before.equipment) !== JSON.stringify(fields.equipment);
    if (!needsUpdate) continue;

    nextGanttRentals[index] = {
      ...ganttRental,
      rentalId: normalizeEquipmentRef(linkedRental.id),
      sourceRentalId: normalizeEquipmentRef(linkedRental.id),
      originalRentalId: normalizeEquipmentRef(ganttRental.originalRentalId) || normalizeEquipmentRef(linkedRental.id),
      equipmentId: fields.equipmentId,
      equipmentInv: fields.equipmentInv,
      inventoryNumber: fields.inventoryNumber,
      serialNumber: fields.serialNumber,
      equipment: fields.equipment.length ? fields.equipment : (Array.isArray(ganttRental.equipment) ? ganttRental.equipment : []),
    };
    ganttUpdated += 1;
    pushChange({
      collection: 'gantt_rentals',
      id: normalizeEquipmentRef(ganttRental.id),
      action: 'sync_from_canonical_rental',
      before,
      after: {
        rentalId: normalizeEquipmentRef(linkedRental.id),
        equipmentId: fields.equipmentId,
        equipmentInv: fields.equipmentInv,
        serialNumber: fields.serialNumber,
        equipment: fields.equipment,
      },
      source: rentalResolved.source,
      warnings: rentalResolved.warnings,
    });
  }

  return {
    summary: {
      rentalsScanned: rentalList.length,
      rentalsUpdated,
      ganttScanned: ganttList.length,
      ganttUpdated,
      skipped,
      reportedChanges: changes.length,
      manualReview: manualReview.length,
      truncated: changes.length >= maxChanges,
    },
    changes,
    manualReview,
    nextRentals,
    nextGanttRentals,
  };
}

module.exports = {
  analyzeRentalEquipmentDiagnostics,
  planRentalEquipmentBackfill,
  equipmentIdentity,
};
