const { buildEquipmentIndex, resolveRecordEquipment } = require('./rental-link-diagnostics');

function asArray(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}

function text(value) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  if (!normalized || normalized === 'undefined' || normalized === 'null') return '';
  return normalized;
}

function lower(value) {
  return text(value).toLowerCase();
}

function dateKey(value) {
  return text(value).slice(0, 10);
}

function firstText(values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return '';
}

function uniq(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => {
    if (Array.isArray(entryValue)) return entryValue.length > 0;
    if (entryValue && typeof entryValue === 'object') return Object.keys(entryValue).length > 0;
    return entryValue !== undefined && entryValue !== null && entryValue !== '';
  }));
}

function linkedRentalIds(gantt) {
  return uniq([gantt?.rentalId, gantt?.sourceRentalId, gantt?.originalRentalId]);
}

function recordLinkIds(record) {
  return uniq([
    record?.rentalId,
    record?.rental,
    record?.classicRentalId,
    record?.sourceRentalId,
    record?.originalRentalId,
    record?.ganttRentalId,
    record?.ganttId,
  ]);
}

function serviceLinkIds(record) {
  return uniq([
    ...recordLinkIds(record),
    record?.repairId,
    record?.serviceId,
    record?.serviceTicketId,
  ]);
}

function referenceMatches(recordIds, targetIds) {
  return recordIds.some(id => targetIds.has(id));
}

function getRelatedCollections(gantt, collections) {
  const targetIds = new Set(uniq([gantt?.id, ...linkedRentalIds(gantt)]));
  const documents = asArray(collections.documents).filter(item => referenceMatches(recordLinkIds(item), targetIds));
  const payments = asArray(collections.payments).filter(item => referenceMatches(recordLinkIds(item), targetIds));
  const deliveries = asArray(collections.deliveries).filter(item => referenceMatches(recordLinkIds(item), targetIds));
  const service = asArray(collections.service).filter(item => referenceMatches(serviceLinkIds(item), targetIds));
  return { documents, payments, deliveries, service };
}

function clientKey(record) {
  return firstText([record?.clientId, record?.client, record?.clientName]).toLowerCase();
}

function sameClientStrict(gantt, rental) {
  const ganttClientId = text(gantt?.clientId);
  const rentalClientId = text(rental?.clientId);
  if (ganttClientId || rentalClientId) return Boolean(ganttClientId && rentalClientId && ganttClientId === rentalClientId);
  const ganttName = lower(gantt?.client || gantt?.clientName);
  const rentalName = lower(rental?.client || rental?.clientName);
  return Boolean(ganttName && rentalName && ganttName === rentalName);
}

function sameDates(gantt, rental) {
  const ganttStart = dateKey(gantt?.startDate || gantt?.dateFrom);
  const ganttEnd = dateKey(gantt?.endDate || gantt?.plannedReturnDate || gantt?.dateTo);
  const rentalStart = dateKey(rental?.startDate || rental?.dateFrom);
  const rentalEnd = dateKey(rental?.endDate || rental?.plannedReturnDate || rental?.dateTo);
  return Boolean(ganttStart && rentalStart && ganttEnd && rentalEnd && ganttStart === rentalStart && ganttEnd === rentalEnd);
}

function datesOverlap(gantt, rental) {
  const ganttStart = dateKey(gantt?.startDate || gantt?.dateFrom);
  const ganttEnd = dateKey(gantt?.endDate || gantt?.plannedReturnDate || gantt?.dateTo) || ganttStart;
  const rentalStart = dateKey(rental?.startDate || rental?.dateFrom);
  const rentalEnd = dateKey(rental?.endDate || rental?.plannedReturnDate || rental?.dateTo) || rentalStart;
  if (!ganttStart || !rentalStart) return false;
  return ganttStart <= rentalEnd && rentalStart <= ganttEnd;
}

function sameEquipment(ganttResolution, rentalResolution) {
  if (ganttResolution.equipmentId && rentalResolution.equipmentId) {
    return ganttResolution.equipmentId === rentalResolution.equipmentId;
  }
  const ganttRefs = new Set(ganttResolution.refs.map(ref => ref.value).filter(Boolean));
  return rentalResolution.refs.some(ref => ganttRefs.has(ref.value));
}

function candidateDto(rental, matchTypes) {
  return compactObject({
    rentalId: text(rental?.id),
    id: text(rental?.id),
    clientId: text(rental?.clientId),
    client: text(rental?.client || rental?.clientName),
    equipmentId: text(rental?.equipmentId),
    equipmentInv: text(rental?.equipmentInv),
    inventoryNumber: text(rental?.inventoryNumber),
    serialNumber: text(rental?.serialNumber),
    startDate: dateKey(rental?.startDate || rental?.dateFrom),
    endDate: dateKey(rental?.endDate || rental?.plannedReturnDate || rental?.dateTo),
    contractNumber: firstText([rental?.contractNumber, rental?.number]),
    externalId: text(rental?.externalId),
    matchTypes,
  });
}

function legacyFieldValues(record) {
  return uniq([
    record?.classicRentalId,
    record?.contractId,
    record?.contractNumber,
    record?.number,
    record?.externalId,
    record?.legacyId,
    record?.legacyRentalId,
  ]);
}

function findCandidates(gantt, rentals, equipmentIndex) {
  const ganttResolution = resolveRecordEquipment(gantt, equipmentIndex);
  const rentalResolutions = new Map(rentals.map(rental => [rental, resolveRecordEquipment(rental, equipmentIndex)]));
  const matches = new Map();

  function add(rental, type) {
    const id = text(rental?.id);
    if (!id) return;
    if (!matches.has(id)) matches.set(id, { rental, matchTypes: new Set() });
    matches.get(id).matchTypes.add(type);
  }

  for (const rental of rentals) {
    const rentalResolution = rentalResolutions.get(rental);
    const equipmentOk = sameEquipment(ganttResolution, rentalResolution);
    const datesExact = sameDates(gantt, rental);
    const datesOk = datesOverlap(gantt, rental);
    if (sameClientStrict(gantt, rental) && equipmentOk && datesExact) add(rental, 'client_equipment_dates');
    if (equipmentOk && datesExact) add(rental, 'equipment_dates');
    if (equipmentOk && datesOk && !datesExact) add(rental, 'equipment_date_overlap');

    const ganttContractValues = uniq([gantt?.contractNumber, gantt?.number]);
    const rentalContractValues = uniq([rental?.contractNumber, rental?.number]);
    if (ganttContractValues.some(value => rentalContractValues.includes(value))) add(rental, 'contractNumber_number');

    if (text(gantt?.externalId) && text(gantt?.externalId) === text(rental?.externalId)) add(rental, 'externalId');

    const ganttLegacyValues = legacyFieldValues(gantt);
    const rentalLegacyValues = legacyFieldValues(rental);
    if (ganttLegacyValues.some(value => rentalLegacyValues.includes(value))) add(rental, 'legacy_fields');
  }

  return [...matches.values()].map(({ rental, matchTypes }) => candidateDto(rental, [...matchTypes].sort()));
}

function isSpecialPlannerRow(gantt) {
  const id = text(gantt?.id);
  const rentalId = firstText([gantt?.rentalId, gantt?.sourceRentalId, gantt?.originalRentalId]);
  const sourceType = lower(gantt?.sourceType);
  const operationType = lower(gantt?.operationType);
  const type = lower(gantt?.type || gantt?.kind);
  const status = lower(gantt?.status || gantt?.rentalStatus);
  const client = lower(gantt?.client || gantt?.clientName);
  return (
    id.startsWith('delivery:') ||
    id.startsWith('service:') ||
    rentalId.startsWith('delivery:') ||
    rentalId.startsWith('service:') ||
    ['delivery', 'service', 'downtime', 'maintenance', 'planner'].includes(sourceType) ||
    ['delivery', 'shipping', 'receiving', 'service', 'downtime', 'maintenance'].includes(operationType) ||
    ['delivery', 'service', 'downtime', 'maintenance', 'planner_event'].includes(type) ||
    ['downtime', 'service', 'maintenance'].includes(status) ||
    client.includes('простой') ||
    client.includes('сервис')
  );
}

function rowDto(gantt) {
  return compactObject({
    ganttId: text(gantt?.id),
    id: text(gantt?.id),
    rentalId: text(gantt?.rentalId),
    sourceRentalId: text(gantt?.sourceRentalId),
    originalRentalId: text(gantt?.originalRentalId),
    client: text(gantt?.client),
    clientId: text(gantt?.clientId),
    clientName: text(gantt?.clientName),
    equipment: Array.isArray(gantt?.equipment) ? gantt.equipment : text(gantt?.equipment),
    equipmentId: text(gantt?.equipmentId),
    model: firstText([gantt?.model, gantt?.equipmentModel, gantt?.equipmentName, gantt?.equipmentLabel]),
    serialNumber: text(gantt?.serialNumber),
    inventoryNumber: firstText([gantt?.inventoryNumber, gantt?.equipmentInv]),
    startDate: dateKey(gantt?.startDate || gantt?.dateFrom),
    endDate: dateKey(gantt?.endDate || gantt?.plannedReturnDate || gantt?.dateTo),
    status: text(gantt?.status),
    amount: gantt?.amount,
    price: gantt?.price,
    manager: firstText([gantt?.manager, gantt?.responsible, gantt?.responsibleName]),
    responsible: firstText([gantt?.responsible, gantt?.manager]),
    createdAt: text(gantt?.createdAt || gantt?.created_at),
    updatedAt: text(gantt?.updatedAt || gantt?.updated_at),
    contractNumber: firstText([gantt?.contractNumber, gantt?.number]),
    externalId: text(gantt?.externalId),
  });
}

function classifyBrokenGanttRow({ gantt, rentals, rentalsById, equipmentIndex, collections }) {
  const linkedIds = linkedRentalIds(gantt);
  const linkedRentals = linkedIds.map(id => rentalsById.get(id)).filter(Boolean);
  if (linkedRentals.length > 0) return null;

  const related = getRelatedCollections(gantt, collections);
  const candidates = findCandidates(gantt, rentals, equipmentIndex);
  const hasRelated = related.documents.length > 0 || related.payments.length > 0 || related.deliveries.length > 0 || related.service.length > 0;
  const missingDates = !dateKey(gantt?.startDate || gantt?.dateFrom) || !dateKey(gantt?.endDate || gantt?.plannedReturnDate || gantt?.dateTo);
  const missingEquipment = !firstText([gantt?.equipmentId, gantt?.equipmentInv, gantt?.inventoryNumber, gantt?.serialNumber, gantt?.equipment]);
  const missingClient = !clientKey(gantt);
  const specialPlannerRow = isSpecialPlannerRow(gantt);

  let reason = 'NO_LINKED_RENTAL';
  if (linkedIds.length > 0) reason = 'STALE_GANTT_ROW';
  if (candidates.some(candidate => candidate.matchTypes.includes('legacy_fields'))) reason = 'POSSIBLE_LEGACY_RENTAL';
  if (candidates.length > 1) reason = 'MULTIPLE_CANDIDATES';
  if (hasRelated || missingDates || missingEquipment || missingClient) reason = 'NEED_MANUAL_REVIEW';
  if (specialPlannerRow) reason = 'NEED_MANUAL_REVIEW';

  let group = 'C';
  let recommendation = 'manual_review';
  if (specialPlannerRow) {
    group = 'D';
    recommendation = 'leave';
  } else if (candidates.length === 0 && !hasRelated && !missingDates && !missingEquipment && !missingClient) {
    group = 'A';
    recommendation = 'delete_or_archive_after_backup';
  } else if (
    candidates.length === 1 &&
    candidates[0].matchTypes.includes('client_equipment_dates') &&
    !hasRelated
  ) {
    group = 'B';
    recommendation = 'link_to_candidate_after_backup';
    reason = 'POSSIBLE_LEGACY_RENTAL';
  }

  const targetRentalId = group === 'B' ? candidates[0].rentalId : '';
  const confidence = group === 'B' ? 'high' : (candidates.length === 1 ? 'medium' : 'low');
  return compactObject({
    ...rowDto(gantt),
    linkedRentalIds: linkedIds,
    hasDocuments: related.documents.length > 0,
    hasPayments: related.payments.length > 0,
    hasDeliveries: related.deliveries.length > 0,
    hasServiceTickets: related.service.length > 0,
    relatedCounts: {
      documents: related.documents.length,
      payments: related.payments.length,
      deliveries: related.deliveries.length,
      service: related.service.length,
    },
    matches: {
      clientEquipmentDates: candidates.filter(item => item.matchTypes.includes('client_equipment_dates')),
      equipmentDates: candidates.filter(item => item.matchTypes.includes('equipment_dates')),
      contractNumber: candidates.filter(item => item.matchTypes.includes('contractNumber_number')),
      externalId: candidates.filter(item => item.matchTypes.includes('externalId')),
      legacyFields: candidates.filter(item => item.matchTypes.includes('legacy_fields')),
      all: candidates,
    },
    candidateCount: candidates.length,
    reason,
    group,
    confidence,
    repairAllowed: group === 'B' && Boolean(targetRentalId),
    repairAction: group === 'B' && targetRentalId ? 'link_gantt_to_rental' : '',
    recommendation,
    targetRentalId,
    manualReviewReasons: [
      candidates.length > 1 ? 'multiple_candidates' : '',
      hasRelated ? 'has_related_records' : '',
      missingDates ? 'incomplete_dates' : '',
      missingEquipment ? 'incomplete_equipment' : '',
      missingClient ? 'unclear_client' : '',
      specialPlannerRow ? 'special_planner_row' : '',
    ].filter(Boolean),
  });
}

function buildBrokenGanttRentalsRepairPlan(collections = {}) {
  const rentals = asArray(collections.rentals);
  const ganttRentals = asArray(collections.gantt_rentals || collections.ganttRentals);
  const equipment = asArray(collections.equipment);
  const rentalsById = new Map(rentals.map(rental => [text(rental?.id), rental]).filter(([id]) => id));
  const equipmentIndex = buildEquipmentIndex(equipment);
  const brokenRows = ganttRentals
    .map(gantt => classifyBrokenGanttRow({ gantt, rentals, rentalsById, equipmentIndex, collections }))
    .filter(Boolean);

  const groups = { A: [], B: [], C: [], D: [] };
  for (const row of brokenRows) groups[row.group].push(row);

  return {
    generatedAt: new Date().toISOString(),
    productionDataChanged: false,
    summary: {
      rentalsTotal: rentals.length,
      ganttRentalsTotal: ganttRentals.length,
      brokenRows: brokenRows.length,
      groupADeleteOrArchive: groups.A.length,
      groupBRelink: groups.B.length,
      groupCManualReview: groups.C.length,
      groupDLeaveUntouched: groups.D.length,
    },
    groups,
    rows: brokenRows,
  };
}

function sanitizeRepairRow(row) {
  const candidateIds = uniq((row?.matches?.all || []).map(candidate => candidate?.rentalId || candidate?.id));
  return {
    ganttId: text(row?.ganttId || row?.id),
    id: text(row?.id || row?.ganttId),
    rentalId: text(row?.rentalId),
    sourceRentalId: text(row?.sourceRentalId),
    originalRentalId: text(row?.originalRentalId),
    linkedRentalIds: Array.isArray(row?.linkedRentalIds) ? row.linkedRentalIds.map(text).filter(Boolean) : [],
    clientId: text(row?.clientId),
    clientName: firstText([row?.clientName, row?.client]),
    equipmentId: text(row?.equipmentId),
    model: text(row?.model),
    serialNumber: text(row?.serialNumber),
    inventoryNumber: text(row?.inventoryNumber),
    startDate: text(row?.startDate),
    endDate: text(row?.endDate),
    status: text(row?.status),
    reason: text(row?.reason),
    group: text(row?.group),
    confidence: text(row?.confidence),
    repairAllowed: Boolean(row?.repairAllowed),
    repairAction: text(row?.repairAction),
    foundRental: Boolean(row?.targetRentalId),
    foundEquipment: Boolean(row?.equipmentId || row?.inventoryNumber || row?.serialNumber),
    recommendation: text(row?.recommendation),
    targetRentalId: text(row?.targetRentalId),
    candidatesCount: Number(row?.candidateCount || 0),
    candidateCount: Number(row?.candidateCount || 0),
    candidateIds,
    candidates: candidateIds.map(id => ({ id, rentalId: id })),
    flags: {
      hasDocuments: Boolean(row?.hasDocuments),
      hasPayments: Boolean(row?.hasPayments),
      hasDeliveries: Boolean(row?.hasDeliveries),
      hasService: Boolean(row?.hasService || row?.hasServiceTickets),
      hasSafeSingleCandidate: Boolean(row?.group === 'B' && row?.targetRentalId),
    },
  };
}

function countValidGanttLinks(ganttRentals, rentalsById) {
  return ganttRentals.filter(gantt => linkedRentalIds(gantt).some(id => rentalsById.has(id))).length;
}

function buildAdminGanttRentalRepairDiagnostics(collections = {}, options = {}) {
  const targetId = text(options.targetId) || 'GR-1776257615497';
  const rentals = asArray(collections.rentals);
  const ganttRentals = asArray(collections.gantt_rentals || collections.ganttRentals);
  const rentalsById = new Map(rentals.map(rental => [text(rental?.id), rental]).filter(([id]) => id));
  const plan = buildBrokenGanttRentalsRepairPlan(collections);
  const groups = Object.fromEntries(
    Object.entries(plan.groups).map(([group, rows]) => [group, rows.map(sanitizeRepairRow)]),
  );
  const brokenRows = plan.rows.map(sanitizeRepairRow);
  const targetRow = brokenRows.find(row => row.ganttId === targetId || row.id === targetId) || null;
  const targetExists = ganttRentals.some(row => text(row?.id) === targetId);

  return {
    ok: true,
    generatedAt: plan.generatedAt,
    productionDataChanged: false,
    counts: {
      rentals: rentals.length,
      totalRentals: rentals.length,
      ganttRentals: ganttRentals.length,
      totalGanttRentals: ganttRentals.length,
      validLinks: countValidGanttLinks(ganttRentals, rentalsById),
      brokenRows: brokenRows.length,
      groupA: groups.A.length,
      groupB: groups.B.length,
      groupC: groups.C.length,
      groupD: groups.D.length,
    },
    groups,
    brokenRows,
    target: {
      id: targetId,
      found: targetExists,
      broken: Boolean(targetRow),
      status: targetRow ? 'broken' : (targetExists ? 'linked_or_special_without_issue' : 'not_found'),
      row: targetRow,
    },
  };
}

function buildDryRunOperations(plan) {
  const deleteRows = plan.groups.A.map(row => ({
    type: 'delete_gantt_row',
    id: row.ganttId,
    reason: row.reason,
    before: row,
    after: null,
  }));
  const linkRows = plan.groups.B.map(row => ({
    type: 'link_gantt_row',
    id: row.ganttId,
    reason: row.reason,
    before: {
      rentalId: row.rentalId || '',
      sourceRentalId: row.sourceRentalId || '',
      originalRentalId: row.originalRentalId || '',
    },
    after: {
      rentalId: row.targetRentalId,
      sourceRentalId: row.targetRentalId,
      originalRentalId: row.targetRentalId,
    },
  }));
  const manualRows = [...plan.groups.C, ...plan.groups.D].map(row => ({
    type: row.group === 'D' ? 'leave_untouched' : 'manual_review',
    id: row.ganttId,
    reason: row.reason,
    before: row,
    after: row,
  }));
  return {
    dryRun: true,
    productionDataChanged: false,
    summary: {
      deleteCount: deleteRows.length,
      linkCount: linkRows.length,
      manualReviewCount: plan.groups.C.length,
      leaveUntouchedCount: plan.groups.D.length,
    },
    operations: [...deleteRows, ...linkRows, ...manualRows],
  };
}

function allowedRepairIds(plan, ids = null) {
  const allowed = new Set(plan.groups.B.map(row => row.ganttId));
  if (!Array.isArray(ids)) return allowed;
  return new Set(ids.map(text).filter(id => allowed.has(id)));
}

function buildSafeRepairOperations(plan, options = {}) {
  const ids = allowedRepairIds(plan, options.ids);
  const requestedCount = Array.isArray(options.ids) ? options.ids.map(text).filter(Boolean).length : plan.groups.B.length;
  const operations = plan.groups.B
    .filter(row => ids.has(row.ganttId))
    .map(row => ({
      type: 'link_gantt_row',
      id: row.ganttId,
      reason: row.reason,
      confidence: row.confidence || 'high',
      repairAllowed: true,
      before: {
        rentalId: row.rentalId || '',
        sourceRentalId: row.sourceRentalId || '',
        originalRentalId: row.originalRentalId || '',
      },
      after: {
        rentalId: row.targetRentalId,
        sourceRentalId: row.targetRentalId,
        originalRentalId: row.targetRentalId,
      },
    }));

  return {
    dryRun: options.apply !== true,
    productionDataChanged: false,
    summary: {
      requestedCount,
      repairableCount: operations.length,
      skippedCount: Math.max(0, requestedCount - operations.length),
    },
    operations,
  };
}

function applyRepairPlan(collections = {}, plan, options = {}) {
  if (options.apply !== true) {
    return { applied: false, collections, operations: buildSafeRepairOperations(plan, options) };
  }
  if (!options.backupVerified || !options.confirm) {
    throw new Error('--apply requires --backup-verified and --confirm=APPLY_GANTT_REPAIR');
  }

  const deleteIds = new Set(plan.groups.A.map(row => row.ganttId));
  const ids = allowedRepairIds(plan, options.ids);
  const relinkById = new Map(plan.groups.B
    .filter(row => ids.has(row.ganttId))
    .map(row => [row.ganttId, row.targetRentalId]));
  const ganttRentals = asArray(collections.gantt_rentals || collections.ganttRentals);
  const nextGanttRentals = ganttRentals
    .filter(row => !(options.allowDeletes === true && deleteIds.has(text(row?.id))))
    .map(row => {
      const id = text(row?.id);
      const targetRentalId = relinkById.get(id);
      if (!targetRentalId) return row;
      return {
        ...row,
        rentalId: targetRentalId,
        sourceRentalId: targetRentalId,
        originalRentalId: targetRentalId,
      };
    });
  return {
    applied: true,
    collections: { ...collections, gantt_rentals: nextGanttRentals },
    operations: buildSafeRepairOperations(plan, { ...options, apply: true }),
  };
}

module.exports = {
  buildBrokenGanttRentalsRepairPlan,
  buildAdminGanttRentalRepairDiagnostics,
  buildDryRunOperations,
  buildSafeRepairOperations,
  applyRepairPlan,
  isSpecialPlannerRow,
};
