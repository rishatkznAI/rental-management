const { normalizeEquipmentRef } = require('./equipment-matching');

const NORMALIZED_EQUIPMENT_FIELDS = ['equipmentId', 'equipmentInv', 'inventoryNumber', 'serialNumber'];
const EQUIPMENT_FIELD_ALIASES = ['equipmentId', 'equipmentInv', 'inventoryNumber', 'serialNumber', 'equipment'];

function asArray(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}

function text(value) {
  return normalizeEquipmentRef(value);
}

function lower(value) {
  return text(value).toLowerCase();
}

function dateValue(value) {
  return text(value).slice(0, 10);
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => {
    if (Array.isArray(entryValue)) return entryValue.length > 0;
    return entryValue !== undefined && entryValue !== null && entryValue !== '';
  }));
}

function equipmentModel(equipment) {
  return [
    equipment?.manufacturer,
    equipment?.brand,
    equipment?.model,
    equipment?.name,
    equipment?.title,
  ].map(text).filter(Boolean).join(' ').trim();
}

function equipmentDto(equipment) {
  if (!equipment) return null;
  return compact({
    id: text(equipment.id),
    equipmentId: text(equipment.id),
    equipmentInv: text(equipment.equipmentInv || equipment.invNumber || equipment.inv),
    inventoryNumber: text(equipment.inventoryNumber || equipment.equipmentInv || equipment.invNumber || equipment.inv),
    serialNumber: text(equipment.serialNumber),
    model: equipmentModel(equipment),
    status: text(equipment.status),
    owner: text(equipment.owner || equipment.ownerName),
    category: text(equipment.category),
  });
}

function recordDto(record, extra = {}) {
  return compact({
    id: text(record?.id),
    rentalId: text(record?.rentalId),
    ganttId: text(record?.ganttId || record?.id),
    client: text(record?.client || record?.clientName),
    clientId: text(record?.clientId),
    equipmentId: text(record?.equipmentId),
    equipmentInv: text(record?.equipmentInv),
    inventoryNumber: text(record?.inventoryNumber),
    serialNumber: text(record?.serialNumber),
    model: text(record?.model || record?.equipmentModel || record?.equipmentName || record?.equipmentLabel),
    startDate: dateValue(record?.startDate || record?.dateFrom),
    endDate: dateValue(record?.endDate || record?.plannedReturnDate || record?.dateTo),
    status: text(record?.status),
    ...extra,
  });
}

function buildEquipmentIndex(equipmentList) {
  const byId = new Map();
  const byInventory = new Map();
  const byEquipmentInv = new Map();
  const bySerial = new Map();

  function add(map, value, equipment) {
    const key = text(value);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(equipment);
  }

  for (const equipment of equipmentList) {
    add(byId, equipment?.id, equipment);
    add(byInventory, equipment?.inventoryNumber, equipment);
    add(byInventory, equipment?.equipmentInv, equipment);
    add(byInventory, equipment?.invNumber, equipment);
    add(byInventory, equipment?.inv, equipment);
    add(byEquipmentInv, equipment?.equipmentInv, equipment);
    add(byEquipmentInv, equipment?.invNumber, equipment);
    add(byEquipmentInv, equipment?.inv, equipment);
    add(bySerial, equipment?.serialNumber, equipment);
  }

  return { byId, byInventory, byEquipmentInv, bySerial };
}

function uniqueById(equipmentItems) {
  const seen = new Set();
  const result = [];
  for (const equipment of equipmentItems || []) {
    const id = text(equipment?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(equipment);
  }
  return result;
}

function equipmentRefs(record) {
  const refs = [];
  for (const field of NORMALIZED_EQUIPMENT_FIELDS) {
    const value = text(record?.[field]);
    if (value) refs.push({ field, value, legacy: false });
  }
  const legacyEquipment = record?.equipment;
  const legacyValues = Array.isArray(legacyEquipment) ? legacyEquipment : [legacyEquipment];
  for (const value of legacyValues.map(text).filter(Boolean)) {
    refs.push({ field: 'equipment', value, legacy: true });
  }
  return refs;
}

function matchesForRef(ref, index) {
  if (!ref?.value) return [];
  if (ref.field === 'equipmentId') return index.byId.get(ref.value) || [];
  if (ref.field === 'serialNumber') return index.bySerial.get(ref.value) || [];
  if (ref.field === 'equipmentInv') {
    return uniqueById([...(index.byEquipmentInv.get(ref.value) || []), ...(index.byInventory.get(ref.value) || [])]);
  }
  if (ref.field === 'inventoryNumber') {
    return uniqueById(index.byInventory.get(ref.value) || []);
  }
  return uniqueById([
    ...(index.byId.get(ref.value) || []),
    ...(index.byInventory.get(ref.value) || []),
    ...(index.byEquipmentInv.get(ref.value) || []),
    ...(index.bySerial.get(ref.value) || []),
  ]);
}

function resolveRecordEquipment(record, index) {
  const refs = equipmentRefs(record);
  const matchedByField = [];
  const warnings = [];

  for (const ref of refs) {
    const matches = matchesForRef(ref, index);
    if (matches.length > 1) warnings.push(`ambiguous_${ref.field}:${ref.value}`);
    if (matches.length === 0) warnings.push(`unresolved_${ref.field}:${ref.value}`);
    matchedByField.push({ ...ref, matches: matches.map(equipmentDto) });
  }

  const allMatches = uniqueById(matchedByField.flatMap(item => item.matches.map(match => ({ id: match.id, ...match }))));
  const matchedIds = [...new Set(matchedByField.flatMap(item => item.matches.map(match => match.id)).filter(Boolean))];
  const normalizedIds = [...new Set(matchedByField
    .filter(item => !item.legacy)
    .flatMap(item => item.matches.map(match => match.id))
    .filter(Boolean))];
  const legacyIds = [...new Set(matchedByField
    .filter(item => item.legacy)
    .flatMap(item => item.matches.map(match => match.id))
    .filter(Boolean))];
  const conflict = matchedIds.length > 1;
  const ambiguous = conflict || matchedByField.some(item => item.matches.length > 1);
  const resolvedId = !ambiguous && matchedIds.length === 1 ? matchedIds[0] : '';
  const resolvedEquipment = resolvedId ? allMatches.find(item => item.id === resolvedId) : null;
  const source = resolvedId
    ? matchedByField.find(item => item.matches.some(match => match.id === resolvedId))?.field || 'unknown'
    : 'unresolved';

  return {
    refs,
    matchedByField,
    matchedIds,
    normalizedIds,
    legacyIds,
    equipment: resolvedEquipment,
    equipmentId: resolvedId,
    hasNormalizedRefs: refs.some(ref => !ref.legacy),
    hasLegacyRefs: refs.some(ref => ref.legacy),
    legacyOnly: Boolean(resolvedId && legacyIds.includes(resolvedId) && normalizedIds.length === 0),
    ambiguous,
    conflict,
    warnings,
    source,
  };
}

function clientMatches(gantt, rental) {
  const ganttClientId = text(gantt?.clientId);
  const rentalClientId = text(rental?.clientId);
  if (ganttClientId || rentalClientId) return Boolean(ganttClientId && rentalClientId && ganttClientId === rentalClientId);
  const ganttName = lower(gantt?.client || gantt?.clientName);
  const rentalName = lower(rental?.client || rental?.clientName);
  return Boolean(ganttName && rentalName && ganttName === rentalName);
}

function datesMatch(gantt, rental) {
  const ganttStart = dateValue(gantt?.startDate || gantt?.dateFrom);
  const ganttEnd = dateValue(gantt?.endDate || gantt?.plannedReturnDate || gantt?.dateTo);
  const rentalStart = dateValue(rental?.startDate || rental?.dateFrom);
  const rentalEnd = dateValue(rental?.endDate || rental?.plannedReturnDate || rental?.dateTo);
  if (!ganttStart || !rentalStart) return false;
  if (ganttStart === rentalStart && (!ganttEnd || !rentalEnd || ganttEnd === rentalEnd)) return true;
  if (!ganttEnd || !rentalEnd) return false;
  return ganttStart <= rentalEnd && rentalStart <= ganttEnd;
}

function equipmentMatches(ganttResolution, rentalResolution) {
  if (ganttResolution.equipmentId && rentalResolution.equipmentId) {
    return ganttResolution.equipmentId === rentalResolution.equipmentId;
  }
  const ganttRefs = new Set(ganttResolution.refs.map(ref => ref.value).filter(Boolean));
  return rentalResolution.refs.some(ref => ganttRefs.has(ref.value));
}

function candidateDto(rental, resolution) {
  return recordDto(rental, {
    rentalId: text(rental?.id),
    equipment: resolution.equipment,
    equipmentSource: resolution.source,
  });
}

function findGanttRentalCandidates(gantt, rentals, rentalResolutions, ganttResolution) {
  return rentals
    .filter(rental => clientMatches(gantt, rental))
    .filter(rental => datesMatch(gantt, rental))
    .filter(rental => equipmentMatches(ganttResolution, rentalResolutions.get(rental) || { refs: [] }))
    .map(rental => candidateDto(rental, rentalResolutions.get(rental) || { source: 'unresolved' }));
}

function hasRentalId(gantt) {
  return Boolean(text(gantt?.rentalId));
}

function sameEquipment(a, b) {
  if (!a?.equipmentId || !b?.equipmentId) return true;
  return a.equipmentId === b.equipmentId;
}

function mismatchReasons(ganttResolution, rentalResolution) {
  const reasons = [];
  if (ganttResolution.equipmentId && rentalResolution.equipmentId && ganttResolution.equipmentId !== rentalResolution.equipmentId) {
    reasons.push('equipmentId_mismatch');
  }
  const ganttInv = text(ganttResolution.equipment?.inventoryNumber || ganttResolution.equipment?.equipmentInv);
  const rentalInv = text(rentalResolution.equipment?.inventoryNumber || rentalResolution.equipment?.equipmentInv);
  if (ganttInv && rentalInv && ganttInv !== rentalInv) reasons.push('inventoryNumber_mismatch');
  const ganttSerial = text(ganttResolution.equipment?.serialNumber);
  const rentalSerial = text(rentalResolution.equipment?.serialNumber);
  if (ganttSerial && rentalSerial && ganttSerial !== rentalSerial) reasons.push('serialNumber_mismatch');
  return reasons;
}

function duplicateInventoryGroups(equipmentList) {
  const groups = new Map();
  for (const equipment of equipmentList) {
    const values = [...new Set([
      equipment?.inventoryNumber,
      equipment?.equipmentInv,
      equipment?.invNumber,
      equipment?.inv,
    ].map(text).filter(Boolean))];
    for (const value of values) {
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(equipment);
    }
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([inventoryNumber, items]) => ({
      inventoryNumber,
      count: items.length,
      equipment: items.map(item => equipmentDto(item)),
      equipmentIds: items.map(item => text(item?.id)).filter(Boolean),
      reason: 'duplicate_inventory_number',
      severity: 'warning',
      suggestedAction: 'Проверьте карточки техники и оставьте уникальный инвентарный номер перед автоматическими связями.',
    }));
}

function pushUnsafe(list, record, extra) {
  list.push(recordDto(record, {
    severity: 'critical',
    suggestedAction: 'Проверьте запись вручную. Автоматическая привязка может связать аренду с неверной техникой.',
    ...extra,
  }));
}

function buildRentalLinkDiagnostics({ equipment = [], rentals = [], ganttRentals = [] } = {}) {
  const equipmentList = asArray(equipment);
  const rentalList = asArray(rentals);
  const ganttList = asArray(ganttRentals);
  const equipmentIndex = buildEquipmentIndex(equipmentList);
  const rentalResolutions = new Map(rentalList.map(rental => [rental, resolveRecordEquipment(rental, equipmentIndex)]));
  const rentalsById = new Map(rentalList.map(rental => [text(rental?.id), rental]).filter(([id]) => id));

  const result = {
    summary: {
      rentalsTotal: rentalList.length,
      ganttTotal: ganttList.length,
      equipmentTotal: equipmentList.length,
      rentalsWithoutEquipment: 0,
      rentalsLegacyOnlyEquipment: 0,
      ganttWithoutRentalId: 0,
      ganttEquipmentMismatch: 0,
      duplicateInventoryNumbers: 0,
      unsafeRecords: 0,
    },
    rentalsWithoutEquipment: [],
    rentalsLegacyOnlyEquipment: [],
    ganttWithoutRentalId: [],
    ganttEquipmentMismatch: [],
    duplicateInventoryNumbers: duplicateInventoryGroups(equipmentList),
    unsafeRecords: [],
  };

  for (const rental of rentalList) {
    const resolution = rentalResolutions.get(rental);
    if (!resolution.equipmentId) {
      const reason = resolution.ambiguous ? 'equipment_ambiguous' : 'equipment_unresolved';
      result.rentalsWithoutEquipment.push(recordDto(rental, {
        rentalId: text(rental?.id),
        reason,
        severity: resolution.ambiguous ? 'critical' : 'warning',
        equipmentRefs: resolution.refs,
        warnings: resolution.warnings,
        suggestedAction: resolution.ambiguous
          ? 'Есть несколько возможных карточек техники. Выберите правильную технику вручную.'
          : 'Заполните equipmentId или уникальный inventoryNumber/serialNumber после ручной проверки.',
      }));
      if (resolution.ambiguous || resolution.conflict) {
        pushUnsafe(result.unsafeRecords, rental, {
          rentalId: text(rental?.id),
          reason,
          equipmentRefs: resolution.refs,
          candidates: resolution.matchedByField,
        });
      }
    }

    if (resolution.legacyOnly) {
      result.rentalsLegacyOnlyEquipment.push(recordDto(rental, {
        rentalId: text(rental?.id),
        legacyOnly: true,
        equipment: resolution.equipment,
        equipmentSource: resolution.source,
        reason: 'legacy_equipment_only',
        severity: 'info',
        suggestedAction: 'После проверки можно перенести ссылку из legacy-поля equipment в стабильные поля техники.',
      }));
    }

    if (resolution.conflict) {
      pushUnsafe(result.unsafeRecords, rental, {
        rentalId: text(rental?.id),
        reason: 'equipment_identifier_conflict',
        candidates: resolution.matchedByField,
      });
    }
  }

  for (const gantt of ganttList) {
    const ganttResolution = resolveRecordEquipment(gantt, equipmentIndex);
    const rentalId = text(gantt?.rentalId);
    const linkedRental = rentalId ? rentalsById.get(rentalId) : null;

    if (!hasRentalId(gantt) || !linkedRental) {
      const candidates = findGanttRentalCandidates(gantt, rentalList, rentalResolutions, ganttResolution);
      const reason = !hasRentalId(gantt)
        ? (candidates.length === 0 ? 'noCandidate' : candidates.length > 1 ? 'multipleCandidates' : 'singleCandidate')
        : 'brokenRentalId';
      result.ganttWithoutRentalId.push(recordDto(gantt, {
        ganttId: text(gantt?.id),
        rentalId,
        reason,
        severity: reason === 'singleCandidate' ? 'warning' : 'critical',
        candidateCount: candidates.length,
        candidates,
        suggestedAction: reason === 'singleCandidate'
          ? 'Проверьте единственного кандидата вручную перед заполнением rentalId.'
          : 'Нельзя безопасно восстановить rentalId автоматически. Требуется ручная проверка.',
      }));
      pushUnsafe(result.unsafeRecords, gantt, {
        ganttId: text(gantt?.id),
        rentalId,
        reason,
        candidateCount: candidates.length,
        candidates,
      });
      continue;
    }

    const rentalResolution = rentalResolutions.get(linkedRental) || resolveRecordEquipment(linkedRental, equipmentIndex);
    if (!sameEquipment(ganttResolution, rentalResolution)) {
      const reasons = mismatchReasons(ganttResolution, rentalResolution);
      result.ganttEquipmentMismatch.push(recordDto(gantt, {
        ganttId: text(gantt?.id),
        rentalId,
        rentalStartDate: dateValue(linkedRental?.startDate || linkedRental?.dateFrom),
        rentalEndDate: dateValue(linkedRental?.endDate || linkedRental?.plannedReturnDate || linkedRental?.dateTo),
        ganttEquipment: ganttResolution.equipment,
        rentalEquipment: rentalResolution.equipment,
        reason: reasons.join(',') || 'equipment_mismatch',
        severity: 'critical',
        suggestedAction: 'Сверьте карточку аренды и запись планировщика вручную; автоматическая замена техники небезопасна.',
      }));
      pushUnsafe(result.unsafeRecords, gantt, {
        ganttId: text(gantt?.id),
        rentalId,
        reason: reasons.join(',') || 'equipment_mismatch',
        ganttEquipment: ganttResolution.equipment,
        rentalEquipment: rentalResolution.equipment,
      });
    }

    if (ganttResolution.conflict) {
      pushUnsafe(result.unsafeRecords, gantt, {
        ganttId: text(gantt?.id),
        rentalId,
        reason: 'equipment_identifier_conflict',
        candidates: ganttResolution.matchedByField,
      });
    }
  }

  result.summary.rentalsWithoutEquipment = result.rentalsWithoutEquipment.length;
  result.summary.rentalsLegacyOnlyEquipment = result.rentalsLegacyOnlyEquipment.length;
  result.summary.ganttWithoutRentalId = result.ganttWithoutRentalId.length;
  result.summary.ganttEquipmentMismatch = result.ganttEquipmentMismatch.length;
  result.summary.duplicateInventoryNumbers = result.duplicateInventoryNumbers.length;
  result.summary.unsafeRecords = result.unsafeRecords.length;
  return result;
}

module.exports = {
  EQUIPMENT_FIELD_ALIASES,
  buildRentalLinkDiagnostics,
  resolveRecordEquipment,
};
