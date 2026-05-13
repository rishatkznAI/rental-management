const fs = require('fs');

const REPAIR_REASON = 'Создана ошибочным smoke-возвратом';
const CLOSED_RENTAL_STATUSES = new Set(['closed', 'returned', 'completed', 'cancelled', 'canceled']);

function asArray(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}

function text(value) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  if (!normalized || normalized === 'undefined' || normalized === 'null') return '';
  return normalized;
}

function dateKey(value) {
  return text(value).slice(0, 10);
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

function linkedGanttRentalIds(gantt) {
  return uniq([gantt?.rentalId, gantt?.sourceRentalId, gantt?.originalRentalId]);
}

function recordIds(record) {
  return uniq([
    record?.rentalId,
    record?.rental,
    record?.classicRentalId,
    record?.sourceRentalId,
    record?.originalRentalId,
    record?.ganttRentalId,
    record?.ganttId,
    record?.serviceTicketId,
    record?.serviceId,
    record?.repairId,
  ]);
}

function referencesAny(record, ids) {
  const target = new Set(ids);
  return recordIds(record).some(id => target.has(id));
}

function collectionRelatedToIds(collection, ids) {
  const target = new Set(ids);
  return asArray(collection).filter(item => referencesAny(item, target));
}

function stringContainsAny(record, values) {
  const raw = JSON.stringify(record || {});
  return values.some(value => value && raw.includes(value));
}

function summarizeRental(rental) {
  if (!rental) return null;
  return compactObject({
    id: rental.id,
    status: rental.status,
    startDate: rental.startDate,
    endDate: rental.endDate,
    plannedReturnDate: rental.plannedReturnDate,
    actualReturnDate: rental.actualReturnDate,
    returnedAt: rental.returnedAt,
    returnDate: rental.returnDate,
    manager: rental.manager || rental.managerName,
    clientId: rental.clientId,
    client: rental.client || rental.clientName,
    equipmentId: rental.equipmentId,
    equipmentInv: rental.equipmentInv,
    equipment: rental.equipment,
    history: asArray(rental.history),
  });
}

function summarizeGantt(gantt) {
  if (!gantt) return null;
  return compactObject({
    id: gantt.id,
    status: gantt.status,
    rentalId: gantt.rentalId,
    sourceRentalId: gantt.sourceRentalId,
    originalRentalId: gantt.originalRentalId,
    startDate: gantt.startDate,
    endDate: gantt.endDate,
    plannedReturnDate: gantt.plannedReturnDate,
    actualReturnDate: gantt.actualReturnDate,
    returnedAt: gantt.returnedAt,
    equipmentId: gantt.equipmentId,
    equipmentInv: gantt.equipmentInv,
  });
}

function summarizeServiceTicket(ticket) {
  if (!ticket) return null;
  return compactObject({
    id: ticket.id,
    status: ticket.status,
    archived: ticket.archived,
    source: ticket.source,
    reason: ticket.reason,
    description: ticket.description,
    rentalId: ticket.rentalId,
    equipmentId: ticket.equipmentId,
    createdAt: ticket.createdAt,
    createdBy: ticket.createdBy || ticket.createdByUserName,
    photos: ticket.photos,
    workLog: asArray(ticket.workLog),
    parts: ticket.parts,
    resultData: ticket.resultData,
  });
}

function eventTime(event) {
  return text(event?.createdAt || event?.date || event?.timestamp || event?.time);
}

function findReturnEvent(auditLogs, rentalId, serviceTicketId) {
  return asArray(auditLogs)
    .filter(event => event.action === 'rentals.return')
    .filter(event => (
      text(event.entityId) === rentalId ||
      text(event.after?.rentalId) === rentalId ||
      text(event.metadata?.rentalId) === rentalId ||
      (serviceTicketId && text(event.after?.serviceTicketId) === serviceTicketId)
    ))
    .sort((left, right) => eventTime(right).localeCompare(eventTime(left)))[0] || null;
}

function isAutomaticReturnWorkLogEntry(entry) {
  const value = `${entry?.text || ''} ${entry?.type || ''}`.toLowerCase();
  return value.includes('автоматически создан') && (value.includes('возврат') || value.includes('приёмк') || value.includes('приемк'));
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasRealTicketData(ticket, related) {
  const reasons = [];
  const workLog = asArray(ticket?.workLog);
  const nonAutomaticWorkLog = workLog.filter(entry => !isAutomaticReturnWorkLogEntry(entry));
  if (nonAutomaticWorkLog.length > 0) reasons.push('service.workLog содержит ручные записи');
  if (nonEmptyArray(ticket?.comments)) reasons.push('service.comments не пустой');
  if (nonEmptyArray(ticket?.repairPhotos)) reasons.push('service.repairPhotos не пустой');
  if (nonEmptyArray(ticket?.photos)) reasons.push('service.photos не пустой');
  if (nonEmptyArray(ticket?.files) || nonEmptyArray(ticket?.attachments)) reasons.push('service files/attachments не пустые');
  if (nonEmptyArray(ticket?.parts)) reasons.push('service.parts не пустой');
  if (nonEmptyArray(ticket?.works)) reasons.push('service.works не пустой');
  if (nonEmptyArray(ticket?.resultData?.partsUsed)) reasons.push('service.resultData.partsUsed не пустой');
  if (nonEmptyArray(ticket?.resultData?.worksPerformed)) reasons.push('service.resultData.worksPerformed не пустой');
  if (text(ticket?.result) || text(ticket?.resultData?.summary)) reasons.push('service содержит результат работ');
  if (related.repairWorkItems.length > 0) reasons.push('есть repair_work_items');
  if (related.repairPartItems.length > 0) reasons.push('есть repair_part_items');
  if (related.fieldTrips.length > 0) reasons.push('есть service_field_trips');
  return { hasRealData: reasons.length > 0, reasons };
}

function inferPreviousRentalState({ rental, gantt, returnEvent }) {
  const before = returnEvent?.before || returnEvent?.metadata?.before || returnEvent?.metadata?.previousRental || null;
  const previousStatus = text(before?.status);
  const previousEndDate = dateKey(before?.endDate || before?.plannedReturnDate);
  if (previousStatus) {
    return {
      ok: true,
      confidence: 'audit-before',
      rental: {
        status: previousStatus,
        endDate: before.endDate,
        plannedReturnDate: before.plannedReturnDate,
        actualReturnDate: before.actualReturnDate,
        returnedAt: before.returnedAt,
        returnDate: before.returnDate,
      },
      gantt: {
        status: before.ganttStatus || before.status,
        endDate: before.ganttEndDate || before.endDate || before.plannedReturnDate,
        actualReturnDate: before.ganttActualReturnDate,
        returnedAt: before.ganttReturnedAt,
      },
    };
  }

  const returnDate = dateKey(returnEvent?.after?.returnDate || rental?.actualReturnDate || gantt?.endDate);
  const currentStatus = text(rental?.status);
  const ganttReturned = text(gantt?.status) === 'returned';
  if (returnEvent && currentStatus === 'closed' && ganttReturned && returnDate) {
    return {
      ok: true,
      confidence: 'inferred-from-return-event',
      rental: {
        status: 'active',
        endDate: rental?.endDate,
        plannedReturnDate: dateKey(rental?.plannedReturnDate || rental?.endDate || gantt?.plannedReturnDate || undefined),
        actualReturnDate: undefined,
        returnedAt: undefined,
        returnDate: undefined,
      },
      gantt: {
        status: 'active',
        endDate: dateKey(rental?.plannedReturnDate || rental?.endDate || gantt?.plannedReturnDate || undefined) || undefined,
        actualReturnDate: undefined,
        returnedAt: undefined,
      },
      warning: 'Предыдущее состояние не записано в audit.before; статус active восстановлен по подтверждённому rentals.return и текущим closed/returned.',
    };
  }

  return {
    ok: false,
    reason: 'Не удалось определить предыдущее состояние аренды из audit/history.',
    previousEndDate,
  };
}

function hasOtherTouchedRentals({ collections, rentalId, ganttId, serviceTicketId }) {
  const touched = [];
  for (const item of asArray(collections.gantt_rentals)) {
    if (text(item.id) === ganttId) continue;
    if (linkedGanttRentalIds(item).includes(rentalId)) touched.push({ collection: 'gantt_rentals', id: item.id });
  }
  for (const item of asArray(collections.service)) {
    if (text(item.id) === serviceTicketId) continue;
    if (recordIds(item).includes(rentalId)) touched.push({ collection: 'service', id: item.id });
  }
  return touched;
}

function buildAccidentalReturnRepairPlan(collections, options = {}) {
  const rentalId = text(options.rentalId);
  if (!rentalId) throw new Error('rentalId is required');

  const rentals = asArray(collections.rentals);
  const ganttRentals = asArray(collections.gantt_rentals);
  const auditLogs = [...asArray(collections.audit_logs), ...asArray(collections.audit_log)];
  const rental = rentals.find(item => text(item.id) === rentalId) || null;
  const gantt = ganttRentals.find(item => linkedGanttRentalIds(item).includes(rentalId)) || null;
  const targetIds = uniq([rentalId, gantt?.id]);
  const guessedService = asArray(collections.service).find(item => referencesAny(item, new Set(targetIds))) || null;
  const returnEvent = findReturnEvent(auditLogs, rentalId, guessedService?.id);
  const serviceId = text(returnEvent?.after?.serviceTicketId || options.serviceId || guessedService?.id);
  const serviceTicket = asArray(collections.service).find(item => text(item.id) === serviceId) || guessedService || null;
  const equipmentId = text(gantt?.equipmentId || rental?.equipmentId || serviceTicket?.equipmentId);
  const relatedIds = uniq([rentalId, gantt?.id, serviceTicket?.id]);
  const serviceIds = uniq([serviceTicket?.id]);

  const related = {
    payments: collectionRelatedToIds(collections.payments, relatedIds),
    documents: collectionRelatedToIds(collections.documents, relatedIds),
    deliveries: collectionRelatedToIds(collections.deliveries, relatedIds),
    notifications: asArray(collections.bot_notifications).filter(item => stringContainsAny(item, relatedIds)),
    auditEvents: auditLogs.filter(item => stringContainsAny(item, relatedIds)).sort((left, right) => eventTime(left).localeCompare(eventTime(right))),
    equipment: asArray(collections.equipment).find(item => text(item.id) === equipmentId) || null,
    repairWorkItems: asArray(collections.repair_work_items).filter(item => referencesAny(item, new Set(serviceIds))),
    repairPartItems: asArray(collections.repair_part_items).filter(item => referencesAny(item, new Set(serviceIds))),
    fieldTrips: asArray(collections.service_field_trips).filter(item => referencesAny(item, new Set(serviceIds))),
    serviceAuditLog: asArray(collections.service_audit_log).filter(item => stringContainsAny(item, serviceIds)),
  };

  const ticketData = hasRealTicketData(serviceTicket, related);
  const previous = inferPreviousRentalState({ rental, gantt, returnEvent });
  const otherTouched = hasOtherTouchedRentals({ collections, rentalId, ganttId: text(gantt?.id), serviceTicketId: text(serviceTicket?.id) });
  const serviceCreatedByReturn = Boolean(
    serviceTicket &&
    returnEvent &&
    text(returnEvent.after?.serviceTicketId) === text(serviceTicket.id) &&
    referencesAny(serviceTicket, new Set([rentalId]))
  );

  const blockers = [];
  const risks = [];
  if (!rental) blockers.push('Аренда не найдена.');
  if (!gantt) blockers.push('Связанная gantt_rentals запись не найдена.');
  if (!returnEvent) blockers.push('Не найден audit event rentals.return.');
  if (!previous.ok) blockers.push(previous.reason);
  if (serviceTicket && !serviceCreatedByReturn) risks.push('Сервисная заявка не подтверждена как созданная целевым rentals.return.');
  if (serviceTicket && ticketData.hasRealData) blockers.push(`Сервисная заявка содержит реальные данные: ${ticketData.reasons.join('; ')}.`);
  if (otherTouched.length > 0) blockers.push(`Есть риск затронуть другие записи: ${otherTouched.map(item => `${item.collection}:${item.id}`).join(', ')}.`);
  if (previous.warning) risks.push(previous.warning);
  if (returnEvent && eventTime(returnEvent)) risks.push(`Audit rentals.return: ${eventTime(returnEvent)}.`);

  const nextRental = rental && previous.ok ? {
    ...rental,
    status: previous.rental.status,
    endDate: previous.rental.endDate,
    plannedReturnDate: previous.rental.plannedReturnDate,
    actualReturnDate: previous.rental.actualReturnDate,
    returnedAt: previous.rental.returnedAt,
    returnDate: previous.rental.returnDate,
    history: [
      ...(Array.isArray(rental.history) ? rental.history : []),
      {
        date: options.now || new Date().toISOString(),
        text: `Административная корректировка: отменён ошибочный smoke-возврат аренды ${rentalId}`,
        author: 'repair-accidental-return',
        type: 'system',
      },
    ],
  } : null;

  const nextGantt = gantt && previous.ok ? {
    ...gantt,
    rentalId: gantt.rentalId || rentalId,
    status: previous.gantt.status === 'closed' ? 'active' : previous.gantt.status,
    endDate: previous.gantt.endDate || previous.rental.plannedReturnDate || gantt.endDate,
    actualReturnDate: previous.gantt.actualReturnDate,
    returnedAt: previous.gantt.returnedAt,
  } : null;

  const nextServiceTicket = serviceTicket && serviceCreatedByReturn && !ticketData.hasRealData ? {
    ...serviceTicket,
    status: 'cancelled',
    archived: true,
    archivedAt: options.now || new Date().toISOString(),
    archiveReason: REPAIR_REASON,
    cancellationReason: REPAIR_REASON,
    workLog: [
      ...(Array.isArray(serviceTicket.workLog) ? serviceTicket.workLog : []),
      {
        date: options.now || new Date().toISOString(),
        text: REPAIR_REASON,
        author: 'repair-accidental-return',
        type: 'status_change',
      },
    ],
  } : null;

  const nextEquipment = related.equipment && nextRental && nextGantt ? {
    ...related.equipment,
    status: 'rented',
    currentClient: nextRental.client || related.equipment.currentClient,
    returnDate: nextRental.plannedReturnDate || nextRental.endDate || nextGantt.endDate || related.equipment.returnDate,
    history: [
      ...(Array.isArray(related.equipment.history) ? related.equipment.history : []),
      {
        date: options.now || new Date().toISOString(),
        text: `Административная корректировка: техника снова привязана к активной аренде ${rentalId}`,
        author: 'repair-accidental-return',
        type: 'system',
      },
    ],
  } : null;

  const changes = [];
  if (nextRental) changes.push({ collection: 'rentals', id: rentalId, before: summarizeRental(rental), after: summarizeRental(nextRental) });
  if (nextGantt) changes.push({ collection: 'gantt_rentals', id: gantt.id, before: summarizeGantt(gantt), after: summarizeGantt(nextGantt) });
  if (nextServiceTicket) changes.push({ collection: 'service', id: serviceTicket.id, before: summarizeServiceTicket(serviceTicket), after: summarizeServiceTicket(nextServiceTicket) });
  if (nextEquipment) {
    changes.push({
      collection: 'equipment',
      id: nextEquipment.id,
      before: compactObject({ id: related.equipment.id, status: related.equipment.status, currentClient: related.equipment.currentClient, returnDate: related.equipment.returnDate }),
      after: compactObject({ id: nextEquipment.id, status: nextEquipment.status, currentClient: nextEquipment.currentClient, returnDate: nextEquipment.returnDate }),
    });
  }
  if (nextRental && nextGantt) {
    changes.push({
      collection: 'audit_logs',
      id: 'new audit event',
      action: 'accidental_return.restore',
    });
  }

  return {
    ok: blockers.length === 0,
    rentalId,
    serviceId: text(serviceTicket?.id),
    current: {
      rental: summarizeRental(rental),
      ganttRental: summarizeGantt(gantt),
      serviceTicket: summarizeServiceTicket(serviceTicket),
      equipment: related.equipment ? compactObject({ id: related.equipment.id, status: related.equipment.status, currentClient: related.equipment.currentClient, returnDate: related.equipment.returnDate }) : null,
    },
    proposed: {
      rental: summarizeRental(nextRental),
      ganttRental: summarizeGantt(nextGantt),
      serviceTicket: summarizeServiceTicket(nextServiceTicket) || summarizeServiceTicket(serviceTicket),
      equipment: nextEquipment ? compactObject({ id: nextEquipment.id, status: nextEquipment.status, currentClient: nextEquipment.currentClient, returnDate: nextEquipment.returnDate }) : null,
    },
    proposedRecords: {
      rental: nextRental,
      ganttRental: nextGantt,
      serviceTicket: nextServiceTicket,
      equipment: nextEquipment,
    },
    evidence: {
      returnEvent: returnEvent ? compactObject({
        id: returnEvent.id,
        action: returnEvent.action,
        entityId: returnEvent.entityId,
        createdAt: returnEvent.createdAt,
        date: returnEvent.date,
        userName: returnEvent.userName,
        role: returnEvent.role,
        after: returnEvent.after,
        before: returnEvent.before,
      }) : null,
      previousStateConfidence: previous.confidence || null,
      serviceCreatedByReturn,
      serviceRealData: ticketData,
    },
    related: {
      payments: related.payments,
      documents: related.documents,
      deliveries: related.deliveries,
      notifications: related.notifications,
      auditEvents: related.auditEvents,
      repairWorkItems: related.repairWorkItems,
      repairPartItems: related.repairPartItems,
      serviceFieldTrips: related.fieldTrips,
      serviceAuditLog: related.serviceAuditLog,
      otherTouched,
    },
    changes,
    unchanged: [
      { collection: 'payments', count: related.payments.length },
      { collection: 'documents', count: related.documents.length },
      { collection: 'deliveries', count: related.deliveries.length },
      { collection: 'bot_notifications', count: related.notifications.length },
      ...(nextEquipment ? [] : [{ collection: 'equipment', reason: 'Не меняется: целевая техника не определена или восстановление заблокировано.' }]),
    ],
    blockers,
    risks,
  };
}

function verifyBackup(path) {
  return Boolean(path && fs.existsSync(path));
}

function applyAccidentalReturnRepairPlan(collections, plan, options = {}) {
  if (!plan?.ok) throw new Error(`Repair is blocked: ${(plan?.blockers || []).join('; ')}`);
  if (!options.backupVerified) throw new Error('Repair is blocked: backup is required before apply.');
  const now = options.now || new Date().toISOString();
  const rentalId = plan.rentalId;
  const ganttId = plan.current.ganttRental?.id;
  const serviceId = plan.serviceId;
  const next = {
    ...collections,
    rentals: asArray(collections.rentals).map(item => text(item.id) === rentalId ? plan.proposedRecords.rental : item),
    gantt_rentals: asArray(collections.gantt_rentals).map(item => text(item.id) === ganttId ? plan.proposedRecords.ganttRental : item),
    service: asArray(collections.service).map(item => text(item.id) === serviceId && plan.evidence.serviceCreatedByReturn ? plan.proposedRecords.serviceTicket : item),
    equipment: asArray(collections.equipment).map(item => text(item.id) === text(plan.proposedRecords.equipment?.id) ? plan.proposedRecords.equipment : item),
    audit_logs: [
      ...asArray(collections.audit_logs),
      {
        id: `AUD-ACCIDENTAL-RETURN-${rentalId}-${Date.now()}`,
        action: 'accidental_return.restore',
        entityType: 'rentals',
        entityId: rentalId,
        description: `Административная корректировка ошибочного smoke-возврата аренды ${rentalId}`,
        before: plan.current,
        after: plan.proposed,
        metadata: {
          reason: REPAIR_REASON,
          dryRun: false,
          serviceTicketId: serviceId || null,
          ganttRentalId: ganttId || null,
        },
        createdAt: now,
      },
    ],
  };
  return { collections: next };
}

module.exports = {
  REPAIR_REASON,
  buildAccidentalReturnRepairPlan,
  applyAccidentalReturnRepairPlan,
  verifyBackup,
  hasRealTicketData,
  CLOSED_RENTAL_STATUSES,
};
