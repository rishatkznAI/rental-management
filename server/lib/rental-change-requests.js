const { createRentalHistoryEntry } = require('./audit-history');

const RENTAL_CHANGE_REQUEST_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

const RENTAL_CHANGE_FIELD_LABELS = {
  clientId: 'Клиент',
  client: 'Клиент',
  contact: 'Контактное лицо',
  manager: 'Менеджер',
  startDate: 'Дата начала',
  plannedReturnDate: 'Плановый возврат',
  actualReturnDate: 'Фактический возврат',
  equipment: 'Техника',
  rate: 'Тариф',
  price: 'Стоимость аренды',
  discount: 'Скидка',
  deliveryAddress: 'Адрес доставки',
  deliveryTime: 'Время доставки',
  status: 'Статус аренды',
  comments: 'Комментарий',
  documents: 'Документы',
  internalNotes: 'Внутренние заметки',
  photos: 'Фото',
  attachments: 'Вложения',
  downtimeDays: 'Простой техники',
  downtimeReason: 'Причина простоя',
  writeOffDays: 'Списание дней аренды',
  waivedDays: 'Списание дней аренды',
};

const PROTECTED_KEYWORDS = [
  'downtime',
  'writeoff',
  'writeOff',
  'waived',
  'waiver',
  'paymentAdjustment',
];

function nowIso() {
  return new Date().toISOString();
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayKey() {
  return nowIso().slice(0, 10);
}

function normalizeComparable(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.map(item => normalizeComparable(item));
  if (typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeComparable(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function valuesEqual(a, b) {
  return JSON.stringify(normalizeComparable(a)) === JSON.stringify(normalizeComparable(b));
}

function displayValue(value) {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim() || '—';
}

function getFieldLabel(field) {
  return RENTAL_CHANGE_FIELD_LABELS[field] || field;
}

function getChangedFields(previous, patch) {
  return Object.keys(patch || {}).filter(field => !valuesEqual(previous?.[field], patch[field]));
}

function normalizeRentalIdentifier(value) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  if (!normalized || normalized === 'undefined' || normalized === 'null') return '';
  return normalized;
}

function sameRentalIdentifier(left, right) {
  const normalizedLeft = normalizeRentalIdentifier(left);
  const normalizedRight = normalizeRentalIdentifier(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function uniqueIdentifiers(values) {
  return [...new Set((values || []).map(normalizeRentalIdentifier).filter(Boolean))];
}

function rentalLinkIdsFromGantt(ganttRental) {
  return uniqueIdentifiers([
    ganttRental?.rentalId,
    ganttRental?.sourceRentalId,
    ganttRental?.originalRentalId,
    ganttRental?.classicRentalId,
    ganttRental?.entityId,
    ganttRental?.approvalEntityId,
  ]);
}

function normalizedText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizedClientKey(value) {
  const words = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .match(/[a-zа-я0-9]+/g) || [];
  const legalForms = new Set(['ооо', 'оао', 'зао', 'пао', 'ао', 'ип', 'llc', 'ooo']);
  return words.filter(word => !legalForms.has(word)).join('');
}

function clientNamesCompatible(left, right) {
  const leftKey = normalizedClientKey(left);
  const rightKey = normalizedClientKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const minLength = Math.min(leftKey.length, rightKey.length);
  return minLength >= 8 && (leftKey.includes(rightKey) || rightKey.includes(leftKey));
}

function setHasIntersection(left, right) {
  for (const value of left || []) {
    if (right?.has(value)) return true;
  }
  return false;
}

function equipmentIndexes(equipmentList = []) {
  const byId = new Map();
  const byInventory = new Map();
  const inventoryCounts = new Map();
  const bySerial = new Map();
  const serialCounts = new Map();

  for (const item of equipmentList || []) {
    const id = normalizeRentalIdentifier(item?.id);
    const inventory = normalizeRentalIdentifier(item?.inventoryNumber || item?.equipmentInv || item?.inv);
    const serial = normalizeRentalIdentifier(item?.serialNumber);
    if (id) byId.set(id, item);
    if (inventory) {
      if (!byInventory.has(inventory)) byInventory.set(inventory, item);
      inventoryCounts.set(inventory, (inventoryCounts.get(inventory) || 0) + 1);
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
    bySerial,
    serialCounts,
    hasEquipment: byId.size > 0 || byInventory.size > 0 || bySerial.size > 0,
  };
}

function addEquipmentAliases(target, equipment) {
  if (!equipment) return;
  const id = normalizeRentalIdentifier(equipment.id);
  const inventory = normalizeRentalIdentifier(equipment.inventoryNumber || equipment.equipmentInv || equipment.inv);
  const serial = normalizeRentalIdentifier(equipment.serialNumber);
  if (id) target.ids.add(id);
  if (inventory) target.inventoryNumbers.add(inventory);
  if (serial) target.serialNumbers.add(serial);
}

function equipmentReferenceValues(record) {
  return [
    record?.equipmentId,
    record?.equipmentInv,
    record?.inventoryNumber,
    record?.inv,
    record?.serialNumber,
    record?.equipmentName,
    record?.equipmentLabel,
    record?.equipmentRef,
    record?.equipmentTitle,
    record?.title,
    record?.name,
    record?.label,
    record?.entity,
    record?.unit,
    ...(Array.isArray(record?.equipment) ? record.equipment : []),
    ...(Array.isArray(record?.equipmentIds) ? record.equipmentIds : []),
  ];
}

function equipmentReferenceTokens(value) {
  const normalized = normalizeRentalIdentifier(value);
  if (!normalized) return [];
  const tokens = new Set([normalized]);
  const parts = normalized.match(/[A-Za-zА-Яа-яЁё0-9]+/g) || [];
  for (const part of parts) {
    if (part.length >= 3) tokens.add(part);
  }
  return [...tokens];
}

function mergeGanttRentalContext(primary, fallback) {
  if (!primary) return fallback || null;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    rentalId: primary.rentalId || fallback.rentalId,
    sourceRentalId: primary.sourceRentalId || fallback.sourceRentalId,
    originalRentalId: primary.originalRentalId || fallback.originalRentalId,
    classicRentalId: primary.classicRentalId || fallback.classicRentalId,
    entityId: primary.entityId || fallback.entityId,
    approvalEntityId: primary.approvalEntityId || fallback.approvalEntityId,
    clientId: primary.clientId || fallback.clientId,
    client: primary.client || fallback.client,
    clientShort: primary.clientShort || fallback.clientShort,
    equipmentId: primary.equipmentId || fallback.equipmentId,
    equipmentInv: primary.equipmentInv || fallback.equipmentInv,
    inventoryNumber: primary.inventoryNumber || fallback.inventoryNumber,
    serialNumber: primary.serialNumber || fallback.serialNumber,
    equipmentName: primary.equipmentName || fallback.equipmentName,
    equipmentLabel: primary.equipmentLabel || fallback.equipmentLabel,
    equipmentRef: primary.equipmentRef || fallback.equipmentRef,
    equipmentTitle: primary.equipmentTitle || fallback.equipmentTitle,
    title: primary.title || fallback.title,
    name: primary.name || fallback.name,
    label: primary.label || fallback.label,
    entity: primary.entity || fallback.entity,
    unit: primary.unit || fallback.unit,
    startDate: primary.startDate || fallback.startDate,
    endDate: primary.endDate || fallback.endDate,
    plannedReturnDate: primary.plannedReturnDate || fallback.plannedReturnDate,
    previousStartDate: primary.previousStartDate || fallback.previousStartDate,
    previousEndDate: primary.previousEndDate || fallback.previousEndDate,
    oldStartDate: primary.oldStartDate || fallback.oldStartDate,
    oldEndDate: primary.oldEndDate || fallback.oldEndDate,
  };
}

function mergeGanttRentalsWithSnapshot(ganttRentals = [], snapshotGanttRental = null) {
  if (!snapshotGanttRental) return ganttRentals || [];
  const snapshotId = normalizeRentalIdentifier(snapshotGanttRental.id);
  let merged = false;
  const mergedList = (ganttRentals || []).map((ganttRental) => {
    if (snapshotId && sameRentalIdentifier(ganttRental?.id, snapshotId)) {
      merged = true;
      return mergeGanttRentalContext(snapshotGanttRental, ganttRental);
    }
    return ganttRental;
  });
  if (!merged) mergedList.push(snapshotGanttRental);
  return mergedList;
}

function buildEquipmentAliases(record, equipmentList = []) {
  const indexes = equipmentIndexes(equipmentList);
  const aliases = {
    ids: new Set(),
    inventoryNumbers: new Set(),
    serialNumbers: new Set(),
    raw: new Set(),
    indexes,
  };

  const explicitEquipmentId = normalizeRentalIdentifier(record?.equipmentId);
  const explicitInventory = normalizeRentalIdentifier(record?.equipmentInv || record?.inventoryNumber);
  const explicitSerial = normalizeRentalIdentifier(record?.serialNumber);

  if (explicitEquipmentId) aliases.ids.add(explicitEquipmentId);
  if (explicitInventory) aliases.inventoryNumbers.add(explicitInventory);
  if (explicitSerial) aliases.serialNumbers.add(explicitSerial);

  const refs = uniqueIdentifiers(equipmentReferenceValues(record).flatMap(equipmentReferenceTokens));

  for (const ref of refs) {
    aliases.raw.add(ref);
    if (indexes.byId.has(ref)) {
      addEquipmentAliases(aliases, indexes.byId.get(ref));
      continue;
    }
    if ((indexes.inventoryCounts.get(ref) || 0) === 1) {
      aliases.inventoryNumbers.add(ref);
      addEquipmentAliases(aliases, indexes.byInventory.get(ref));
      continue;
    }
    if ((indexes.serialCounts.get(ref) || 0) === 1) {
      aliases.serialNumbers.add(ref);
      addEquipmentAliases(aliases, indexes.bySerial.get(ref));
    }
  }

  if (explicitEquipmentId && indexes.byId.has(explicitEquipmentId)) {
    addEquipmentAliases(aliases, indexes.byId.get(explicitEquipmentId));
  }
  if (explicitInventory && (indexes.inventoryCounts.get(explicitInventory) || 0) === 1) {
    addEquipmentAliases(aliases, indexes.byInventory.get(explicitInventory));
  }
  if (explicitSerial && (indexes.serialCounts.get(explicitSerial) || 0) === 1) {
    addEquipmentAliases(aliases, indexes.bySerial.get(explicitSerial));
  }

  return aliases;
}

function equipmentAliasesOverlap(leftRecord, rightRecord, equipmentList = []) {
  const left = buildEquipmentAliases(leftRecord, equipmentList);
  const right = buildEquipmentAliases(rightRecord, equipmentList);

  if (setHasIntersection(left.ids, right.ids)) return true;
  if (setHasIntersection(left.serialNumbers, right.serialNumbers)) return true;

  for (const inventory of left.inventoryNumbers) {
    if (!right.inventoryNumbers.has(inventory)) continue;
    if (!left.indexes.hasEquipment || (left.indexes.inventoryCounts.get(inventory) || 0) <= 1) {
      return true;
    }
  }

  if (!left.indexes.hasEquipment && setHasIntersection(left.raw, right.raw)) return true;
  return false;
}

function rentalDateRange(record, type) {
  if (!record) return { startDate: '', endDate: '' };
  if (type === 'classic') {
    return {
      startDate: String(record.startDate || ''),
      endDate: String(record.plannedReturnDate || record.endDate || ''),
    };
  }
  return {
    startDate: String(record.startDate || ''),
    endDate: String(record.endDate || record.plannedReturnDate || ''),
  };
}

function dateRangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && startB <= endA;
}

function ganttMatchesClassicRental(ganttRental, rental, options = {}) {
  if (!ganttRental || !rental) return false;

  const linkedIds = rentalLinkIdsFromGantt(ganttRental);
  if (linkedIds.length > 0) {
    if (linkedIds.some(id => sameRentalIdentifier(id, rental.id))) return true;
  }

  const ganttClientId = normalizeRentalIdentifier(ganttRental.clientId);
  const rentalClientId = normalizeRentalIdentifier(rental.clientId);
  const sameClient = ganttClientId && rentalClientId
    ? ganttClientId === rentalClientId
    : clientNamesCompatible(ganttRental.client, rental.client);

  const classicRange = rentalDateRange(rental, 'classic');
  const ganttRange = rentalDateRange(ganttRental, 'gantt');
  const sameDates =
    classicRange.startDate === ganttRange.startDate &&
    classicRange.endDate === ganttRange.endDate;
  const compatibleDates = sameDates || dateRangesOverlap(
    classicRange.startDate,
    classicRange.endDate,
    ganttRange.startDate,
    ganttRange.endDate,
  );
  if (!compatibleDates) return false;
  if (!sameClient && !options.allowClientMismatch) return false;

  return equipmentAliasesOverlap(ganttRental, rental, options.equipmentList || []);
}

function ganttMatchesClassicRentalByClientEquipment(ganttRental, rental, options = {}) {
  if (!ganttRental || !rental) return false;

  const ganttClientId = normalizeRentalIdentifier(ganttRental.clientId);
  const rentalClientId = normalizeRentalIdentifier(rental.clientId);
  const sameClient = ganttClientId && rentalClientId
    ? ganttClientId === rentalClientId
    : clientNamesCompatible(ganttRental.client, rental.client);
  if (!sameClient) return false;

  return equipmentAliasesOverlap(ganttRental, rental, options.equipmentList || []);
}

function isOpenClassicRental(rental) {
  const status = normalizedText(rental?.status);
  return !['closed', 'returned', 'completed', 'cancelled', 'canceled'].includes(status) && !rental?.actualReturnDate;
}

function ganttMatchesOpenClassicRentalByEquipment(ganttRental, rental, options = {}) {
  if (!isOpenClassicRental(rental)) return false;
  return equipmentAliasesOverlap(ganttRental, rental, options.equipmentList || []);
}

function dateRangeVariantsForGantt(ganttRental) {
  return [
    rentalDateRange(ganttRental, 'gantt'),
    {
      startDate: String(ganttRental?.previousStartDate || ganttRental?.oldStartDate || ''),
      endDate: String(ganttRental?.previousEndDate || ganttRental?.oldEndDate || ''),
    },
  ].filter(range => range.startDate || range.endDate);
}

function dateRangesCompatibleWithRental(ganttRental, rental) {
  const classicRange = rentalDateRange(rental, 'classic');
  return dateRangeVariantsForGantt(ganttRental).some(range => {
    const sameDates = classicRange.startDate === range.startDate && classicRange.endDate === range.endDate;
    return sameDates || dateRangesOverlap(classicRange.startDate, classicRange.endDate, range.startDate, range.endDate);
  });
}

function ganttMatchesOpenClassicRentalByClient(ganttRental, rental, options = {}) {
  if (!isOpenClassicRental(rental)) return false;
  const ganttClientId = normalizeRentalIdentifier(ganttRental?.clientId);
  const rentalClientId = normalizeRentalIdentifier(rental?.clientId);
  const sameClient = ganttClientId && rentalClientId
    ? ganttClientId === rentalClientId
    : clientNamesCompatible(ganttRental?.client, rental?.client);
  if (!sameClient) return false;
  if (options.requireDateMatch && !dateRangesCompatibleWithRental(ganttRental, rental)) return false;
  return true;
}

function uniqueRentalMatches(matches) {
  const byId = new Map();
  for (const match of matches || []) {
    const id = normalizeRentalIdentifier(match?.rental?.id);
    if (!id || byId.has(id)) continue;
    byId.set(id, match);
  }
  return [...byId.values()];
}

function findRentalsByIds(rentals, ids) {
  const normalizedIds = uniqueIdentifiers(ids);
  if (normalizedIds.length === 0) return [];
  return (rentals || [])
    .map((rental, index) => ({ rental, index }))
    .filter(({ rental }) => normalizedIds.some(id => sameRentalIdentifier(id, rental?.id)));
}

function compactResolutionIds(items, selector) {
  return uniqueIdentifiers((items || []).map(selector)).slice(0, 20);
}

function buildRentalResolutionFailure(status, message, searchedIds, diagnostics = {}) {
  return {
    ok: false,
    status,
    error: message,
    details: {
      searchedIds: uniqueIdentifiers(searchedIds),
      searchedCollections: [
        'rentals.id',
        'gantt_rentals.id',
        'gantt_rentals.rentalId',
        'gantt_rentals.sourceRentalId',
        'gantt_rentals.originalRentalId',
      ],
      ...diagnostics,
    },
  };
}

function buildRentalResolutionSuccess(match, sourceRentalId, linkedGanttRental) {
  const sourceId = normalizeRentalIdentifier(sourceRentalId);
  return {
    ok: true,
    rental: match.rental,
    rentalIndex: match.index,
    rentalId: normalizeRentalIdentifier(match.rental?.id),
    sourceRentalId: sourceId && !sameRentalIdentifier(sourceId, match.rental?.id) ? sourceId : '',
    linkedGanttRental: linkedGanttRental || null,
    linkedGanttRentalId: normalizeRentalIdentifier(linkedGanttRental?.id),
  };
}

function resolveRentalForChangeRequest({
  rentalId,
  linkedGanttRentalId,
  fallbackGanttRental,
  rentals = [],
  ganttRentals = [],
  equipment = [],
  context = '',
} = {}) {
  const requestedRentalId = normalizeRentalIdentifier(rentalId);
  const requestedGanttId = normalizeRentalIdentifier(linkedGanttRentalId);
  const searchedIds = uniqueIdentifiers([requestedRentalId, requestedGanttId]);
  const idForDiagnostics = requestedRentalId || requestedGanttId;
  const snapshotGanttRental = fallbackGanttRental && typeof fallbackGanttRental === 'object'
    ? fallbackGanttRental
    : null;
  const snapshotMatchesRequestedId = snapshotGanttRental && (
    sameRentalIdentifier(snapshotGanttRental.id, requestedGanttId) ||
    sameRentalIdentifier(snapshotGanttRental.id, requestedRentalId)
  );
  const resolverGanttRentals = snapshotMatchesRequestedId
    ? mergeGanttRentalsWithSnapshot(ganttRentals, snapshotGanttRental)
    : (ganttRentals || []);
  const directGanttMatches = resolverGanttRentals
    .filter(ganttRental =>
      sameRentalIdentifier(ganttRental?.id, requestedGanttId) ||
      sameRentalIdentifier(ganttRental?.id, requestedRentalId),
    );

  if (!requestedRentalId && !requestedGanttId) {
    return buildRentalResolutionFailure(
      400,
      'Не передан rentalId для согласования аренды.',
      searchedIds,
      {
        context,
        incomingRentalId: rentalId,
        incomingLinkedGanttRentalId: linkedGanttRentalId,
        incomingRentalIdType: typeof rentalId,
      },
    );
  }

  const directMatches = findRentalsByIds(rentals, [requestedRentalId]);
  if (directMatches.length === 1) {
    const linkedGanttRental = (ganttRentals || []).find(item => sameRentalIdentifier(item?.id, requestedGanttId)) || null;
    return buildRentalResolutionSuccess(directMatches[0], requestedRentalId, linkedGanttRental);
  }
  if (directMatches.length > 1) {
    return buildRentalResolutionFailure(
      409,
      `Найдено несколько карточек аренды с id "${requestedRentalId}". Откройте карточку аренды вручную.`,
      searchedIds,
      {
        context,
        foundRentalById: directMatches.length,
        foundGanttById: directGanttMatches.length,
        rentalCandidateIds: compactResolutionIds(directMatches, match => match.rental?.id),
        ganttCandidateIds: compactResolutionIds(directGanttMatches, item => item?.id),
      },
    );
  }

  const ganttCandidates = uniqueRentalMatches(resolverGanttRentals
    .map((ganttRental, index) => ({ rental: ganttRental, index }))
    .filter(({ rental: ganttRental }) => {
      const byGanttId =
        sameRentalIdentifier(ganttRental?.id, requestedGanttId) ||
        sameRentalIdentifier(ganttRental?.id, requestedRentalId);
      const byLinkedId = rentalLinkIdsFromGantt(ganttRental)
        .some(id => sameRentalIdentifier(id, requestedRentalId));
      return byGanttId || byLinkedId;
    }));

  const diagnosticsBase = {
    context,
    incomingRentalId: requestedRentalId,
    incomingLinkedGanttRentalId: requestedGanttId,
    incomingRentalIdType: typeof rentalId,
    foundRentalById: directMatches.length,
    foundGanttById: directGanttMatches.length,
    foundGanttSnapshotById: snapshotMatchesRequestedId ? 1 : 0,
    foundGanttByLink: Math.max(0, ganttCandidates.length - directGanttMatches.length),
    ganttCandidateIds: compactResolutionIds(ganttCandidates, match => match.rental?.id),
  };

  const linkedIds = uniqueIdentifiers(ganttCandidates.flatMap(({ rental: ganttRental }) => rentalLinkIdsFromGantt(ganttRental)));
  const explicitMatches = findRentalsByIds(rentals, linkedIds);
  if (explicitMatches.length === 1) {
    const linkedGanttRental = ganttCandidates.find(({ rental: ganttRental }) =>
      rentalLinkIdsFromGantt(ganttRental).some(id => sameRentalIdentifier(id, explicitMatches[0].rental.id)),
    )?.rental || ganttCandidates[0]?.rental || null;
    return buildRentalResolutionSuccess(
      explicitMatches[0],
      requestedRentalId || requestedGanttId || linkedGanttRental?.id,
      linkedGanttRental,
    );
  }
  if (explicitMatches.length > 1) {
    return buildRentalResolutionFailure(
      409,
      `Найдено несколько карточек аренды по связи gantt_rentals для id "${requestedRentalId || requestedGanttId}". Откройте карточку аренды вручную.`,
      [...searchedIds, ...linkedIds],
      {
        ...diagnosticsBase,
        linkedIds,
        rentalCandidateIds: compactResolutionIds(explicitMatches, match => match.rental?.id),
      },
    );
  }
  const findShapeMatches = (allowClientMismatch = false) => uniqueRentalMatches(ganttCandidates.flatMap(({ rental: ganttRental }) =>
    (rentals || [])
      .map((rental, index) => ({ rental, index, linkedGanttRental: ganttRental }))
      .filter(({ rental }) => ganttMatchesClassicRental(ganttRental, rental, { equipmentList: equipment, allowClientMismatch })),
  ));
  const strictShapeMatches = findShapeMatches(false);
  const shapeMatches = strictShapeMatches.length > 0 ? strictShapeMatches : findShapeMatches(true);
  if (shapeMatches.length === 1) {
    return buildRentalResolutionSuccess(
      shapeMatches[0],
      requestedRentalId || requestedGanttId || shapeMatches[0].linkedGanttRental?.id,
      shapeMatches[0].linkedGanttRental,
    );
  }
  if (shapeMatches.length > 1) {
    return buildRentalResolutionFailure(
      409,
      `Найдено несколько похожих карточек аренды для id "${requestedRentalId || requestedGanttId}". Откройте карточку аренды вручную.`,
      [...searchedIds, ...linkedIds],
      {
        ...diagnosticsBase,
        linkedIds,
        fallbackCandidateCount: shapeMatches.length,
        fallbackCandidateIds: compactResolutionIds(shapeMatches, match => match.rental?.id),
      },
    );
  }
  const looseSnapshotMatches = snapshotMatchesRequestedId
    ? uniqueRentalMatches(ganttCandidates.flatMap(({ rental: ganttRental }) =>
      (rentals || [])
        .map((rental, index) => ({ rental, index, linkedGanttRental: ganttRental }))
        .filter(({ rental }) => ganttMatchesClassicRentalByClientEquipment(ganttRental, rental, { equipmentList: equipment })),
    ))
    : [];
  if (looseSnapshotMatches.length === 1) {
    return buildRentalResolutionSuccess(
      looseSnapshotMatches[0],
      requestedRentalId || requestedGanttId || looseSnapshotMatches[0].linkedGanttRental?.id,
      looseSnapshotMatches[0].linkedGanttRental,
    );
  }
  if (looseSnapshotMatches.length > 1) {
    return buildRentalResolutionFailure(
      409,
      `Найдено несколько карточек аренды по клиенту и технике для id "${requestedRentalId || requestedGanttId}". Откройте карточку аренды вручную.`,
      [...searchedIds, ...linkedIds],
      {
        ...diagnosticsBase,
        linkedIds,
        fallbackCandidateCount: looseSnapshotMatches.length,
        fallbackCandidateIds: compactResolutionIds(looseSnapshotMatches, match => match.rental?.id),
      },
    );
  }
  const openEquipmentSnapshotMatches = snapshotMatchesRequestedId
    ? uniqueRentalMatches(ganttCandidates.flatMap(({ rental: ganttRental }) =>
      (rentals || [])
        .map((rental, index) => ({ rental, index, linkedGanttRental: ganttRental }))
        .filter(({ rental }) => ganttMatchesOpenClassicRentalByEquipment(ganttRental, rental, { equipmentList: equipment })),
    ))
    : [];
  if (openEquipmentSnapshotMatches.length === 1) {
    return buildRentalResolutionSuccess(
      openEquipmentSnapshotMatches[0],
      requestedRentalId || requestedGanttId || openEquipmentSnapshotMatches[0].linkedGanttRental?.id,
      openEquipmentSnapshotMatches[0].linkedGanttRental,
    );
  }
  if (openEquipmentSnapshotMatches.length > 1) {
    return buildRentalResolutionFailure(
      409,
      `Найдено несколько незакрытых карточек аренды по технике для id "${requestedRentalId || requestedGanttId}". Откройте карточку аренды вручную.`,
      [...searchedIds, ...linkedIds],
      {
        ...diagnosticsBase,
        linkedIds,
        fallbackCandidateCount: openEquipmentSnapshotMatches.length,
        fallbackCandidateIds: compactResolutionIds(openEquipmentSnapshotMatches, match => match.rental?.id),
      },
    );
  }
  const openClientDateSnapshotMatches = snapshotMatchesRequestedId
    ? uniqueRentalMatches(ganttCandidates.flatMap(({ rental: ganttRental }) =>
      (rentals || [])
        .map((rental, index) => ({ rental, index, linkedGanttRental: ganttRental }))
        .filter(({ rental }) => ganttMatchesOpenClassicRentalByClient(ganttRental, rental, { requireDateMatch: true })),
    ))
    : [];
  if (openClientDateSnapshotMatches.length === 1) {
    return buildRentalResolutionSuccess(
      openClientDateSnapshotMatches[0],
      requestedRentalId || requestedGanttId || openClientDateSnapshotMatches[0].linkedGanttRental?.id,
      openClientDateSnapshotMatches[0].linkedGanttRental,
    );
  }
  if (openClientDateSnapshotMatches.length > 1) {
    return buildRentalResolutionFailure(
      409,
      `Найдено несколько незакрытых карточек аренды по клиенту и датам для id "${requestedRentalId || requestedGanttId}". Откройте карточку аренды вручную.`,
      [...searchedIds, ...linkedIds],
      {
        ...diagnosticsBase,
        linkedIds,
        fallbackCandidateCount: openClientDateSnapshotMatches.length,
        fallbackCandidateIds: compactResolutionIds(openClientDateSnapshotMatches, match => match.rental?.id),
      },
    );
  }
  const openClientSnapshotMatches = snapshotMatchesRequestedId
    ? uniqueRentalMatches(ganttCandidates.flatMap(({ rental: ganttRental }) =>
      (rentals || [])
        .map((rental, index) => ({ rental, index, linkedGanttRental: ganttRental }))
        .filter(({ rental }) => ganttMatchesOpenClassicRentalByClient(ganttRental, rental, { requireDateMatch: false })),
    ))
    : [];
  if (openClientSnapshotMatches.length === 1) {
    return buildRentalResolutionSuccess(
      openClientSnapshotMatches[0],
      requestedRentalId || requestedGanttId || openClientSnapshotMatches[0].linkedGanttRental?.id,
      openClientSnapshotMatches[0].linkedGanttRental,
    );
  }
  if (openClientSnapshotMatches.length > 1) {
    return buildRentalResolutionFailure(
      409,
      `Найдено несколько незакрытых карточек аренды по клиенту для id "${requestedRentalId || requestedGanttId}". Откройте карточку аренды вручную.`,
      [...searchedIds, ...linkedIds],
      {
        ...diagnosticsBase,
        linkedIds,
        fallbackCandidateCount: openClientSnapshotMatches.length,
        fallbackCandidateIds: compactResolutionIds(openClientSnapshotMatches, match => match.rental?.id),
      },
    );
  }
  const allFallbackMatches = uniqueRentalMatches([
    ...shapeMatches,
    ...looseSnapshotMatches,
    ...openEquipmentSnapshotMatches,
    ...openClientDateSnapshotMatches,
    ...openClientSnapshotMatches,
  ]);
  if (linkedIds.length > 0) {
    return buildRentalResolutionFailure(
      404,
      `Связанная карточка аренды для "${requestedRentalId || requestedGanttId}" не найдена: в gantt_rentals указана связь ${linkedIds.join(', ')}, но такой rentals.id нет.`,
      [...searchedIds, ...linkedIds],
      {
        ...diagnosticsBase,
        linkedIds,
        fallbackCandidateCount: allFallbackMatches.length,
        fallbackCandidateIds: compactResolutionIds(allFallbackMatches, match => match.rental?.id),
      },
    );
  }

  return buildRentalResolutionFailure(
    404,
    `Не найдена карточка аренды для согласования: id "${idForDiagnostics}", искали в rentals.id, gantt_rentals.id и связях gantt_rentals.`,
    [...searchedIds, ...linkedIds],
    {
      ...diagnosticsBase,
      linkedIds,
      fallbackCandidateCount: allFallbackMatches.length,
      fallbackCandidateIds: compactResolutionIds(allFallbackMatches, match => match.rental?.id),
    },
  );
}

function stripRentalPatchMeta(body = {}) {
  const {
    __linkedGanttRentalId,
    __ganttRentalId,
    __sourceRentalId,
    __rentalId,
    __changeReason,
    __changeComment,
    __changeAttachments,
    linkedGanttRentalId,
    ganttRentalId,
    sourceRentalId,
    rentalId,
    __ganttSnapshot,
    ganttSnapshot,
    ganttRentalSnapshot,
    entityType,
    actionType,
    oldValues,
    newValues,
    changes,
    changeRequestSummary,
    ...patch
  } = body || {};

  return {
    patch,
    meta: {
      rentalId: __rentalId || rentalId || '',
      sourceRentalId: __sourceRentalId || sourceRentalId || '',
      linkedGanttRentalId: __linkedGanttRentalId || __ganttRentalId || linkedGanttRentalId || ganttRentalId || '',
      ganttRentalId: __ganttRentalId || ganttRentalId || linkedGanttRentalId || '',
      ganttSnapshot: (__ganttSnapshot || ganttSnapshot || ganttRentalSnapshot) && typeof (__ganttSnapshot || ganttSnapshot || ganttRentalSnapshot) === 'object'
        ? (__ganttSnapshot || ganttSnapshot || ganttRentalSnapshot)
        : null,
      entityType: entityType || '',
      actionType: actionType || '',
      oldValues: oldValues && typeof oldValues === 'object' ? oldValues : null,
      newValues: newValues && typeof newValues === 'object' ? newValues : null,
      changes: Array.isArray(changes) ? changes : [],
      reason: __changeReason || '',
      comment: __changeComment || '',
      attachments: Array.isArray(__changeAttachments) ? __changeAttachments : [],
    },
  };
}

function hasGanttRentalLink(ganttRental) {
  return rentalLinkIdsFromGantt(ganttRental).length > 0;
}

function compactGanttRentalProblem(ganttRental, resolution) {
  return {
    id: normalizeRentalIdentifier(ganttRental?.id),
    client: ganttRental?.client || '',
    clientId: normalizeRentalIdentifier(ganttRental?.clientId),
    startDate: ganttRental?.startDate || '',
    endDate: ganttRental?.endDate || ganttRental?.plannedReturnDate || '',
    equipmentId: normalizeRentalIdentifier(ganttRental?.equipmentId),
    equipmentInv: normalizeRentalIdentifier(ganttRental?.equipmentInv),
    status: resolution?.status || 0,
    error: resolution?.error || 'Не удалось восстановить связь с rentals.',
  };
}

function logGanttRentalLinkProblems(logger, label, list) {
  if (!logger || typeof logger.warn !== 'function' || !list.length) return;
  logger.warn(`[rental-links] ${label}: ${list.length}`);
  for (const item of list.slice(0, 20)) {
    logger.warn(
      `[rental-links] ${label}: id=${item.id || '—'} client="${item.client || '—'}" ` +
      `period=${item.startDate || '—'}..${item.endDate || '—'} equipment=${item.equipmentInv || item.equipmentId || '—'} ` +
      `reason="${item.error}"`,
    );
  }
  if (list.length > 20) {
    logger.warn(`[rental-links] ${label}: ещё ${list.length - 20} записей скрыто из лога`);
  }
}

function compactGanttRentalDiagnostic(ganttRental, extra = {}) {
  return {
    id: normalizeRentalIdentifier(ganttRental?.id),
    rentalId: normalizeRentalIdentifier(ganttRental?.rentalId),
    sourceRentalId: normalizeRentalIdentifier(ganttRental?.sourceRentalId),
    originalRentalId: normalizeRentalIdentifier(ganttRental?.originalRentalId),
    client: ganttRental?.client || '',
    clientId: normalizeRentalIdentifier(ganttRental?.clientId),
    equipmentId: normalizeRentalIdentifier(ganttRental?.equipmentId),
    equipmentInv: normalizeRentalIdentifier(ganttRental?.equipmentInv),
    equipmentName: normalizeRentalIdentifier(ganttRental?.equipmentName),
    equipmentLabel: normalizeRentalIdentifier(ganttRental?.equipmentLabel),
    equipmentRef: normalizeRentalIdentifier(ganttRental?.equipmentRef),
    startDate: ganttRental?.startDate || '',
    endDate: ganttRental?.endDate || ganttRental?.plannedReturnDate || '',
    ...extra,
  };
}

function compactRentalDiagnostic(rental, extra = {}) {
  return {
    id: normalizeRentalIdentifier(rental?.id),
    client: rental?.client || '',
    clientId: normalizeRentalIdentifier(rental?.clientId),
    equipment: Array.isArray(rental?.equipment) ? rental.equipment : [],
    equipmentId: normalizeRentalIdentifier(rental?.equipmentId),
    equipmentInv: normalizeRentalIdentifier(rental?.equipmentInv),
    equipmentName: normalizeRentalIdentifier(rental?.equipmentName),
    equipmentLabel: normalizeRentalIdentifier(rental?.equipmentLabel),
    equipmentRef: normalizeRentalIdentifier(rental?.equipmentRef),
    inventoryNumber: normalizeRentalIdentifier(rental?.inventoryNumber),
    startDate: rental?.startDate || '',
    plannedReturnDate: rental?.plannedReturnDate || '',
    endDate: rental?.endDate || '',
    status: rental?.status || '',
    ...extra,
  };
}

function analyzeGanttRentalLinks({ rentals = [], ganttRentals = [], equipment = [], targetId = '', limit = 50 } = {}) {
  const rentalIds = new Set((rentals || []).map(item => normalizeRentalIdentifier(item?.id)).filter(Boolean));
  const safeLimit = Math.max(1, Number(limit) || 50);
  const target = normalizeRentalIdentifier(targetId);
  const result = {
    checkedAt: nowIso(),
    rentalsCount: Array.isArray(rentals) ? rentals.length : 0,
    ganttRentalsCount: Array.isArray(ganttRentals) ? ganttRentals.length : 0,
    missingRentalIdCount: 0,
    missingAnyLinkCount: 0,
    brokenRentalIdCount: 0,
    brokenAnyLinkCount: 0,
    missingRentalId: [],
    missingAnyLink: [],
    brokenRentalId: [],
    brokenAnyLink: [],
    targetId: target,
    target: target ? {
      foundInRentals: false,
      foundInGanttRentals: false,
      foundInGanttLinks: false,
      linkedIds: [],
      linkedRentalId: '',
      exactRentalRecord: null,
      exactGanttRecord: null,
      linkedRentals: [],
      fallbackCandidates: [],
      rentals: [],
      ganttRentals: [],
    } : null,
  };

  if (target) {
    result.target.rentals = (rentals || [])
      .filter(item => sameRentalIdentifier(item?.id, target))
      .slice(0, safeLimit)
      .map(item => compactRentalDiagnostic(item));
    result.target.foundInRentals = result.target.rentals.length > 0;
    result.target.exactRentalRecord = result.target.rentals[0] || null;
  }

  for (const ganttRental of (ganttRentals || [])) {
    const linkedIds = rentalLinkIdsFromGantt(ganttRental);
    const rentalId = normalizeRentalIdentifier(ganttRental?.rentalId);
    const hasValidAnyLink = linkedIds.some(id => rentalIds.has(id));

    if (!rentalId) {
      result.missingRentalIdCount += 1;
      if (result.missingRentalId.length < safeLimit) {
        result.missingRentalId.push(compactGanttRentalDiagnostic(ganttRental));
      }
    } else if (!rentalIds.has(rentalId)) {
      result.brokenRentalIdCount += 1;
      if (result.brokenRentalId.length < safeLimit) {
        result.brokenRentalId.push(compactGanttRentalDiagnostic(ganttRental, { linkedIds }));
      }
    }

    if (linkedIds.length === 0) {
      result.missingAnyLinkCount += 1;
      if (result.missingAnyLink.length < safeLimit) {
        result.missingAnyLink.push(compactGanttRentalDiagnostic(ganttRental));
      }
    } else if (!hasValidAnyLink) {
      result.brokenAnyLinkCount += 1;
      if (result.brokenAnyLink.length < safeLimit) {
        result.brokenAnyLink.push(compactGanttRentalDiagnostic(ganttRental, { linkedIds }));
      }
    }

    if (target) {
      const isTargetGantt = sameRentalIdentifier(ganttRental?.id, target);
      const isTargetLink = linkedIds.some(id => sameRentalIdentifier(id, target));
      if (isTargetGantt || isTargetLink) {
        result.target.ganttRentals.push(compactGanttRentalDiagnostic(ganttRental, { linkedIds }));
      }
      if (isTargetGantt) result.target.foundInGanttRentals = true;
      if (isTargetLink) result.target.foundInGanttLinks = true;
    }
  }

  if (target) {
    const exactGanttRecords = (ganttRentals || [])
      .filter(ganttRental => sameRentalIdentifier(ganttRental?.id, target));
    const targetLinkedIds = uniqueIdentifiers(exactGanttRecords.flatMap(ganttRental => rentalLinkIdsFromGantt(ganttRental)));
    const linkedRentals = (rentals || [])
      .filter(rental => targetLinkedIds.some(id => sameRentalIdentifier(id, rental?.id)))
      .slice(0, safeLimit);
    const fallbackCandidates = uniqueRentalMatches(exactGanttRecords.flatMap(ganttRental =>
      (rentals || [])
        .map((rental, index) => ({ rental, index, linkedGanttRental: ganttRental }))
        .filter(({ rental }) =>
          ganttMatchesClassicRental(ganttRental, rental, { equipmentList: equipment }) ||
          ganttMatchesClassicRentalByClientEquipment(ganttRental, rental, { equipmentList: equipment }) ||
          ganttMatchesOpenClassicRentalByEquipment(ganttRental, rental, { equipmentList: equipment }) ||
          ganttMatchesOpenClassicRentalByClient(ganttRental, rental, { requireDateMatch: true }) ||
          ganttMatchesOpenClassicRentalByClient(ganttRental, rental, { requireDateMatch: false }),
        ),
    ));

    result.target.linkedIds = targetLinkedIds;
    result.target.linkedRentalId = normalizeRentalIdentifier(linkedRentals[0]?.id);
    result.target.exactGanttRecord = exactGanttRecords[0]
      ? compactGanttRentalDiagnostic(exactGanttRecords[0], { linkedIds: targetLinkedIds })
      : null;
    result.target.linkedRentals = linkedRentals.map(rental => compactRentalDiagnostic(rental));
    result.target.fallbackCandidates = fallbackCandidates
      .slice(0, safeLimit)
      .map(match => compactRentalDiagnostic(match.rental, {
        linkedGanttRentalId: normalizeRentalIdentifier(match.linkedGanttRental?.id),
      }));
  }

  return result;
}

function logGanttRentalLinkDiagnostics({ readData, logger = console, targetId = '' } = {}) {
  if (typeof readData !== 'function') return null;
  const diagnostics = analyzeGanttRentalLinks({
    rentals: readData('rentals') || [],
    ganttRentals: readData('gantt_rentals') || [],
    equipment: readData('equipment') || [],
    targetId,
  });
  if (logger && typeof logger.log === 'function') {
    logger.log(
      `[rental-links] diagnostics: checked=${diagnostics.ganttRentalsCount}, ` +
      `missingRentalId=${diagnostics.missingRentalIdCount}, brokenRentalId=${diagnostics.brokenRentalIdCount}, ` +
      `missingAnyLink=${diagnostics.missingAnyLinkCount}, brokenAnyLink=${diagnostics.brokenAnyLinkCount}`,
    );
    if (diagnostics.target) {
      logger.log(
        `[rental-links] target ${diagnostics.targetId}: ` +
        `rentals=${diagnostics.target.foundInRentals ? 'yes' : 'no'}, ` +
        `gantt=${diagnostics.target.foundInGanttRentals ? 'yes' : 'no'}, ` +
        `links=${diagnostics.target.foundInGanttLinks ? 'yes' : 'no'}`,
      );
    }
  }
  return diagnostics;
}

function backfillGanttRentalLinks({ readData, writeData, logger = console, dryRun = false } = {}) {
  const rentals = typeof readData === 'function' ? (readData('rentals') || []) : [];
  const ganttRentals = typeof readData === 'function' ? (readData('gantt_rentals') || []) : [];
  const equipment = typeof readData === 'function' ? (readData('equipment') || []) : [];
  const result = {
    checked: Array.isArray(ganttRentals) ? ganttRentals.length : 0,
    missingLink: 0,
    linked: 0,
    ambiguous: [],
    unresolved: [],
    dryRun: Boolean(dryRun),
  };

  if (!Array.isArray(ganttRentals) || ganttRentals.length === 0) return result;

  let changed = false;
  const nextGanttRentals = ganttRentals.map(ganttRental => {
    if (!ganttRental || hasGanttRentalLink(ganttRental)) return ganttRental;
    result.missingLink += 1;

    const resolution = resolveRentalForChangeRequest({
      rentalId: ganttRental.id,
      linkedGanttRentalId: ganttRental.id,
      rentals,
      ganttRentals: [ganttRental],
      equipment,
    });

    if (resolution.ok && resolution.rentalId) {
      result.linked += 1;
      changed = true;
      return { ...ganttRental, rentalId: resolution.rentalId };
    }

    const problem = compactGanttRentalProblem(ganttRental, resolution);
    if (resolution.status === 409) {
      result.ambiguous.push(problem);
    } else {
      result.unresolved.push(problem);
    }
    return ganttRental;
  });

  if (changed && !dryRun && typeof writeData === 'function') {
    writeData('gantt_rentals', nextGanttRentals);
  }

  if (result.linked > 0 && logger && typeof logger.log === 'function') {
    logger.log(`[rental-links] Gantt rental backfill: linked ${result.linked}/${result.missingLink}`);
  }
  logGanttRentalLinkProblems(logger, 'Неоднозначная связь gantt_rentals', result.ambiguous);
  logGanttRentalLinkProblems(logger, 'Не найдена связь gantt_rentals', result.unresolved);

  return result;
}

function calculateRentalDebt(rental, payments = []) {
  if (!rental) return 0;
  const paidAmount = (payments || [])
    .filter(payment => payment.rentalId === rental.id)
    .reduce((sum, payment) => sum + (payment.paidAmount ?? (payment.status === 'paid' ? payment.amount : 0)), 0);
  return Math.max((Number(rental.price) || 0) - (Number(rental.discount) || 0) - paidAmount, 0);
}

function hasProtectedKeyword(field) {
  return PROTECTED_KEYWORDS.some(keyword => field.includes(keyword));
}

function isDocumentsAdditionOnly(previous = [], next = []) {
  if (!Array.isArray(previous) || !Array.isArray(next)) return false;
  return previous.every(item => next.includes(item)) && next.length >= previous.length;
}

function classifyRentalFieldChange({ previousRental, field, newValue, payments = [], today = todayKey() }) {
  const oldValue = previousRental?.[field];

  if (hasProtectedKeyword(field)) {
    return {
      mode: 'approval',
      type: 'Простой / списание дней',
      reason: 'Изменение простоя или списания дней требует согласования администратора.',
    };
  }

  if (field === 'price') {
    return { mode: 'approval', type: 'Изменение цены', reason: 'Изменение стоимости аренды требует согласования.' };
  }

  if (field === 'discount') {
    return { mode: 'approval', type: 'Изменение скидки', reason: 'Изменение скидки требует согласования.' };
  }

  if (field === 'rate') {
    return { mode: 'approval', type: 'Изменение тарифа', reason: 'Изменение коммерческих условий требует согласования.' };
  }

  if (field === 'startDate') {
    return { mode: 'approval', type: 'Изменение дат задним числом', reason: 'Дата начала аренды меняет уже согласованный период.' };
  }

  if (field === 'plannedReturnDate') {
    const oldDate = toDate(oldValue);
    const nextDate = toDate(newValue);
    const todayDate = toDate(today);
    if (!oldDate || !nextDate) {
      return { mode: 'approval', type: 'Изменение дат', reason: 'Изменение периода аренды требует проверки.' };
    }
    if (todayDate && nextDate < todayDate) {
      return { mode: 'approval', type: 'Изменение дат задним числом', reason: 'Новая дата возврата находится в прошлом.' };
    }
    if (nextDate < oldDate) {
      return { mode: 'approval', type: 'Сокращение аренды', reason: 'Сокращение аренды требует согласования.' };
    }
    return { mode: 'immediate', type: 'Продление аренды', reason: 'Продление применяется сразу после проверки конфликтов.' };
  }

  if (field === 'actualReturnDate') {
    const nextDate = toDate(newValue);
    const todayDate = toDate(today);
    if (nextDate && todayDate && nextDate < todayDate) {
      return { mode: 'approval', type: 'Изменение дат задним числом', reason: 'Фактическая дата возврата находится в прошлом.' };
    }
    return { mode: 'immediate', type: 'Фактический возврат', reason: 'Актуальная дата возврата применяется сразу.' };
  }

  if (field === 'status') {
    if (newValue === 'closed' && calculateRentalDebt(previousRental, payments) > 0) {
      return { mode: 'approval', type: 'Закрытие аренды с долгом', reason: 'Закрытие аренды при задолженности требует согласования.' };
    }
    return { mode: 'immediate', type: 'Изменение статуса', reason: 'Статус аренды применяется сразу.' };
  }

  if ((field === 'client' || field === 'clientId') && previousRental?.status === 'active') {
    return { mode: 'approval', type: 'Изменение клиента в активной аренде', reason: 'Клиент в активной аренде меняется только через согласование.' };
  }

  if (field === 'equipment' && previousRental?.status === 'active') {
    return { mode: 'approval', type: 'Изменение техники в активной аренде', reason: 'Техника в активной аренде меняется только через согласование.' };
  }

  if (field === 'documents') {
    if (isDocumentsAdditionOnly(oldValue || [], newValue || [])) {
      return { mode: 'immediate', type: 'Добавление документов', reason: 'Добавление документов применяется сразу.' };
    }
    return { mode: 'approval', type: 'Удаление документов', reason: 'Удаление или корректировка документов требует согласования.' };
  }

  if (field === 'comments') {
    return { mode: 'immediate', type: 'Комментарий', reason: 'Комментарии применяются сразу.' };
  }

  if (field === 'photos' || field === 'attachments' || field === 'internalNotes') {
    return { mode: 'immediate', type: field === 'photos' ? 'Прикрепление фото' : field === 'internalNotes' ? 'Внутренние заметки' : 'Вложения', reason: 'Операционное дополнение применяется сразу.' };
  }

  return { mode: 'immediate', type: 'Операционное изменение', reason: 'Изменение не относится к списку обязательных согласований.' };
}

function splitRentalPatch({ previousRental, patch, payments = [], today = todayKey() }) {
  const immediatePatch = {};
  const approvalChanges = [];

  for (const field of getChangedFields(previousRental, patch)) {
    const classification = classifyRentalFieldChange({
      previousRental,
      field,
      newValue: patch[field],
      payments,
      today,
    });

    if (classification.mode === 'approval') {
      approvalChanges.push({
        field,
        label: getFieldLabel(field),
        oldValue: previousRental?.[field],
        newValue: patch[field],
        type: classification.type,
        reason: classification.reason,
      });
    } else {
      immediatePatch[field] = patch[field];
    }
  }

  return { immediatePatch, approvalChanges };
}

function calculateFinancialImpact(previousRental, field, newValue) {
  const oldPrice = Number(previousRental?.price) || 0;
  const oldDiscount = Number(previousRental?.discount) || 0;
  const oldTotal = oldPrice - oldDiscount;
  const nextPrice = field === 'price' ? Number(newValue) || 0 : oldPrice;
  const nextDiscount = field === 'discount' ? Number(newValue) || 0 : oldDiscount;
  const nextTotal = nextPrice - nextDiscount;
  const amount = nextTotal - oldTotal;

  if (field === 'price' || field === 'discount' || field === 'rate') {
    return {
      amount,
      description: amount === 0
        ? 'Без прямого изменения суммы'
        : `${amount > 0 ? '+' : ''}${amount}`,
    };
  }

  return {
    amount: 0,
    description: 'Без прямого изменения суммы',
  };
}

function buildRentalChangeRequest({
  id,
  rental,
  equipment = [],
  linkedGanttRentalId,
  sourceRentalId,
  change,
  initiator,
  reason,
  comment,
  attachments,
}) {
  const createdAt = nowIso();
  const equipmentRefs = Array.isArray(rental.equipment) ? rental.equipment : [];
  const equipmentSnapshots = equipmentRefs
    .map(ref => {
      const normalizedRef = normalizeText(ref);
      return (equipment || []).find(item => [
        item?.id,
        item?.inventoryNumber,
        item?.serialNumber,
      ].some(value => normalizeText(value) === normalizedRef)) || null;
    })
    .filter(Boolean);
  const primaryEquipment = equipmentSnapshots[0] || null;
  const isDateChange = change.field === 'startDate' || change.field === 'plannedReturnDate' || change.field === 'actualReturnDate';
  const isBackdated = isDateChange && String(change.type || '').includes('задним числом');
  return {
    id,
    entityType: 'rental',
    entityId: rental.id,
    rentalId: rental.id,
    sourceRentalId: sourceRentalId || '',
    linkedGanttRentalId: linkedGanttRentalId || '',
    clientId: rental.clientId || '',
    client: rental.client,
    equipment: Array.isArray(rental.equipment) ? rental.equipment : [],
    requestedBy: initiator?.userId || '',
    initiatorId: initiator?.userId || '',
    initiatorName: initiator?.userName || 'Система',
    initiatorRole: initiator?.userRole || '',
    createdAt,
    status: RENTAL_CHANGE_REQUEST_STATUS.PENDING,
    statusLabel: buildRequestDecisionNotificationStatus(RENTAL_CHANGE_REQUEST_STATUS.PENDING),
    type: isDateChange ? (isBackdated ? 'backdated_rental_date_change' : 'rental_date_change') : change.type,
    typeLabel: change.type,
    field: change.field,
    fieldLabel: change.label,
    oldValue: change.oldValue,
    newValue: change.newValue,
    oldStartDate: change.field === 'startDate' ? change.oldValue : rental.startDate,
    oldPlannedReturnDate: change.field === 'plannedReturnDate' ? change.oldValue : rental.plannedReturnDate,
    oldEndDate: change.field === 'plannedReturnDate' ? change.oldValue : rental.plannedReturnDate,
    newStartDate: change.field === 'startDate' ? change.newValue : rental.startDate,
    newPlannedReturnDate: change.field === 'plannedReturnDate' ? change.newValue : rental.plannedReturnDate,
    newEndDate: change.field === 'plannedReturnDate' ? change.newValue : rental.plannedReturnDate,
    oldValues: { [change.field]: change.oldValue },
    newValues: { [change.field]: change.newValue },
    changes: [{
      field: change.field,
      label: change.label,
      oldValue: change.oldValue,
      newValue: change.newValue,
      type: change.type,
      reason: change.reason,
    }],
    reason: String(reason || '').trim() || change.reason,
    systemReason: change.reason,
    comment: String(comment || '').trim(),
    createdBy: initiator?.userId || '',
    createdByName: initiator?.userName || 'Система',
    rentalNumber: rental.number || rental.id,
    clientName: rental.client || '',
    equipmentName: primaryEquipment
      ? [primaryEquipment.manufacturer, primaryEquipment.model].filter(Boolean).join(' ').trim()
      : String(equipmentRefs[0] || ''),
    equipmentInventoryNumber: primaryEquipment?.inventoryNumber || String(equipmentRefs[0] || ''),
    equipmentSerialNumber: primaryEquipment?.serialNumber || '',
    attachments: Array.isArray(attachments) ? attachments : [],
    financialImpact: calculateFinancialImpact(rental, change.field, change.newValue),
  };
}

function buildRentalImmediateHistoryEntries(previousRental, nextRental, author) {
  const entries = [];
  for (const field of getChangedFields(previousRental, nextRental)) {
    if (field === 'history') continue;
    entries.push(createRentalHistoryEntry(
      author,
      `Изменение применено сразу: ${getFieldLabel(field)}: ${displayValue(previousRental?.[field])} → ${displayValue(nextRental?.[field])}`,
    ));
  }
  return entries;
}

function buildRentalPendingApprovalHistoryEntries(requests = [], author) {
  return (requests || []).map(request => createRentalHistoryEntry(
    author,
    `Изменение отправлено на согласование: ${request.fieldLabel || getFieldLabel(request.field)}: ${displayValue(request.oldValue)} → ${displayValue(request.newValue)}`,
  ));
}

function appendRentalHistory(rental, entries = []) {
  if (!entries.length) return rental;
  return {
    ...rental,
    history: [...(rental.history || []), ...entries],
  };
}

function managerInitials(name = '') {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '—';
  return trimmed.split(/\s+/).map(part => part[0] || '').join('').slice(0, 2).toUpperCase();
}

function rentalStatusToGanttStatus(status) {
  if (status === 'closed') return 'closed';
  if (status === 'active') return 'active';
  return 'created';
}

function applyRentalFieldToGantt(ganttRental, field, value) {
  if (!ganttRental) return ganttRental;
  if (field === 'clientId') return { ...ganttRental, clientId: value };
  if (field === 'client') {
    return { ...ganttRental, client: value, clientShort: String(value || '').substring(0, 20) };
  }
  if (field === 'startDate') return { ...ganttRental, startDate: value };
  if (field === 'plannedReturnDate') return { ...ganttRental, endDate: value };
  if (field === 'actualReturnDate') return { ...ganttRental, endDate: value || ganttRental.endDate, status: 'returned' };
  if (field === 'manager') return { ...ganttRental, manager: value, managerInitials: managerInitials(value) };
  if (field === 'status') return { ...ganttRental, status: rentalStatusToGanttStatus(value) };
  if (field === 'price') return { ...ganttRental, amount: Number(value) || 0 };
  return ganttRental;
}

function syncGanttRentalFields(ganttRental, previousRental, nextRental, author) {
  if (!ganttRental) return ganttRental;
  let nextGantt = { ...ganttRental };
  const entries = [];
  for (const field of getChangedFields(previousRental, nextRental)) {
    const beforeGantt = nextGantt;
    nextGantt = applyRentalFieldToGantt(nextGantt, field, nextRental?.[field]);
    if (beforeGantt !== nextGantt) {
      entries.push(createRentalHistoryEntry(
        author,
        `Карточка аренды обновила планировщик: ${getFieldLabel(field)}: ${displayValue(previousRental?.[field])} → ${displayValue(nextRental?.[field])}`,
      ));
    }
  }
  if (!entries.length) return nextGantt;
  return {
    ...nextGantt,
    comments: [...(nextGantt.comments || []), ...entries],
  };
}

function applyApprovedRentalChangeToGantt(ganttRental, request, author) {
  if (!ganttRental) return ganttRental;
  const nextGantt = applyRentalFieldToGantt(ganttRental, request.field, request.newValue);
  if (nextGantt === ganttRental) return nextGantt;
  return {
    ...nextGantt,
    comments: [
      ...(nextGantt.comments || []),
      createRentalHistoryEntry(
        author,
        `Согласовано и применено: ${request.fieldLabel || getFieldLabel(request.field)}: ${displayValue(request.oldValue)} → ${displayValue(request.newValue)}`,
      ),
    ],
  };
}

function buildRequestDecisionNotificationStatus(status) {
  if (status === RENTAL_CHANGE_REQUEST_STATUS.APPROVED) return 'Согласовано / Применено';
  if (status === RENTAL_CHANGE_REQUEST_STATUS.REJECTED) return 'Отклонено';
  return 'На согласовании';
}

module.exports = {
  RENTAL_CHANGE_REQUEST_STATUS,
  RENTAL_CHANGE_FIELD_LABELS,
  appendRentalHistory,
  applyApprovedRentalChangeToGantt,
  analyzeGanttRentalLinks,
  backfillGanttRentalLinks,
  buildRentalChangeRequest,
  buildRentalImmediateHistoryEntries,
  buildRentalPendingApprovalHistoryEntries,
  buildRequestDecisionNotificationStatus,
  calculateFinancialImpact,
  calculateRentalDebt,
  classifyRentalFieldChange,
  displayValue,
  getChangedFields,
  getFieldLabel,
  logGanttRentalLinkDiagnostics,
  normalizeRentalIdentifier,
  resolveRentalForChangeRequest,
  splitRentalPatch,
  stripRentalPatchMeta,
  syncGanttRentalFields,
  valuesEqual,
};
