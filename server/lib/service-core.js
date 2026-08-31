const { createAuditEntry } = require('./audit-history');
const { resolveCurrentUserAsMechanic } = require('./service-assignment');
const { isPdiServiceTicket } = require('./service-ticket-kind');
const { normalizeServiceTicketForWrite } = require('./service-dto');
const {
  canonicalizeServiceTicketCollection,
  canonicalizeServiceTicketCounterpartyRelation,
} = require('./service-counterparty-relations');
const { assertProductionSmokeFixtureMutationAllowed } = require('./protected-fixtures');
const { linkedRentalIds } = require('./gantt-rental-link-guard');
const { assertClientContractAvailableForNewLink } = require('./client-contract-lifecycle');
const {
  reconcileEquipmentRentalProjection,
} = require('./rental-lifecycle');

function createServiceCore(deps) {
  const {
    readData,
    writeData,
    writeDataBatch: persistDataBatch,
    nowIso,
    equipmentMatchesServiceTicket,
  } = deps;
  if (typeof persistDataBatch !== 'function') {
    throw new TypeError('Service core requires an atomic batch writer.');
  }

  function serviceStatusLabel(status) {
    return ({
      new: 'Новый',
      in_progress: 'В работе',
      waiting_parts: 'Ожидание запчастей',
      needs_revision: 'На доработке',
      ready: 'Готово',
      closed: 'Закрыто',
    })[status] || status;
  }

  function servicePriorityLabel(priority) {
    return ({
      low: 'Низкий',
      medium: 'Средний',
      high: 'Высокий',
      critical: 'Критический',
    })[priority] || priority;
  }

  function openServiceStatuses() {
    return ['new', 'in_progress', 'waiting_parts', 'needs_revision'];
  }

  function readServiceTickets() {
    return readData('service') || [];
  }

  function writeServiceTickets(tickets) {
    return persistServiceTicketBulkReplace(tickets, 'Система');
  }

  function findServiceTicketById(ticketId) {
    const normalizedId = String(ticketId || '').trim().toLowerCase();
    return readServiceTickets().find(ticket => String(ticket.id || '').trim().toLowerCase() === normalizedId) || null;
  }

  function saveServiceTicket(updatedTicket) {
    return persistServiceTicketUpdate(updatedTicket, 'Система');
  }

  function servicePersistenceOptions(options, current, previous = null) {
    const extraEntries = [
      ...(Array.isArray(options?.extraEntries) ? options.extraEntries : []),
      ...(typeof options?.buildExtraEntries === 'function'
        ? (options.buildExtraEntries(current, previous) || [])
        : []),
    ];
    return {
      write: typeof options?.writeDataBatch === 'function'
        ? options.writeDataBatch
        : persistDataBatch,
      extraEntries,
    };
  }

  function applyServiceTicketCreationEffects(ticket, author = 'Система', options = {}) {
    if (!ticket) return;
    const previous = readServiceTickets().find(item => String(item?.id || '') === String(ticket?.id || '')) || null;
    if (ticket?.contractId) {
      assertClientContractAvailableForNewLink(readData, ticket.contractId, {
        allowArchivedContractId: previous?.contractId,
      });
    }
    ticket = canonicalizeServiceTicketCounterpartyRelation(ticket, { readData }, { existing: previous });
    const requestedServiceTickets = Array.isArray(options.serviceTickets)
      ? options.serviceTickets.map(item => String(item?.id || '') === String(ticket.id || '') ? ticket : item)
      : options.serviceTickets;
    const persistence = servicePersistenceOptions(options, ticket, previous);
    if (isPdiServiceTicket(ticket)) {
      if (options.persistService && Array.isArray(requestedServiceTickets)) {
        persistence.write([
          { name: 'service', value: requestedServiceTickets },
          ...persistence.extraEntries,
        ]);
        return { persisted: true, ticket };
      }
      return { persisted: false, ticket };
    }

    const equipmentList = readData('equipment') || [];
    const ganttRentals = readData('gantt_rentals') || [];
    const classicRentals = readData('rentals') || [];
    const storedServiceTickets = Array.isArray(requestedServiceTickets)
      ? requestedServiceTickets
      : readServiceTickets();
    const serviceTickets = storedServiceTickets.some(item => String(item?.id || '') === String(ticket.id || ''))
      ? storedServiceTickets
      : [...storedServiceTickets, ticket];
    const todayStr = nowIso().slice(0, 10);
    const auditText = `Техника переведена в сервис по заявке ${ticket.id}: ${ticket.reason || 'Без причины'}`;

    const nextClassicRentals = classicRentals.map(rental => {
      const matchesActiveRental = equipmentList.some(equipment => (
        equipmentMatchesServiceTicket(ticket, equipment, equipmentList)
        && (
          String(rental?.equipmentId || '') === String(equipment?.id || '')
          || (Array.isArray(rental?.equipment) ? rental.equipment : [rental?.equipment])
            .some(reference => [equipment?.inventoryNumber, equipment?.serialNumber].includes(reference))
        )
        && rental.status === 'active'
        && rental.startDate <= todayStr
        && (rental.plannedReturnDate || rental.endDate) >= todayStr
      ));
      if (!matchesActiveRental) return rental;
      return {
        ...rental,
        actualReturnDate: todayStr,
        status: 'closed',
        history: [
          ...(Array.isArray(rental.history) ? rental.history : []),
          createAuditEntry(author, `Аренда остановлена из-за сервисной заявки ${ticket.id}`),
        ],
      };
    });
    const stoppedClassicIds = new Set(nextClassicRentals.flatMap((rental, index) => (
      rental !== classicRentals[index] ? [String(rental?.id || '')] : []
    )).filter(Boolean));
    const nextRentals = ganttRentals.map(rental => {
      if (!linkedRentalIds(rental).some(id => stoppedClassicIds.has(String(id || '')))) return rental;
      return {
        ...rental,
        endDate: todayStr,
        status: 'returned',
        comments: [
          ...(Array.isArray(rental.comments) ? rental.comments : []),
          {
            date: nowIso(),
            text: `Аренда остановлена из-за сервисной заявки ${ticket.id}`,
            author,
          },
        ],
      };
    });

    const matchedEquipmentIds = new Set(equipmentList
      .filter(item => equipmentMatchesServiceTicket(ticket, item, equipmentList))
      .map(item => String(item.id || '')));
    const lifecycle = reconcileEquipmentRentalProjection({
      equipmentList,
      rentals: nextClassicRentals,
      ganttRentals: nextRentals,
      serviceTickets,
      affectedEquipmentIds: matchedEquipmentIds,
      nowIso,
      author,
      reason: auditText,
    });
    const nextEquipment = lifecycle.nextEquipment;

    assertProductionSmokeFixtureMutationAllowed({
      action: 'service_create',
      existingList: equipmentList,
      nextList: nextEquipment,
    });
    persistence.write([
      ...(options.persistService ? [{ name: 'service', value: serviceTickets }] : []),
      ...(nextClassicRentals.some((item, index) => item !== classicRentals[index]) ? [{ name: 'rentals', value: nextClassicRentals }] : []),
      ...(nextRentals.some((item, index) => item !== ganttRentals[index]) ? [{ name: 'gantt_rentals', value: nextRentals }] : []),
      ...(lifecycle.changed ? [{ name: 'equipment', value: nextEquipment }] : []),
      ...persistence.extraEntries,
    ]);
    return { persisted: Boolean(options.persistService), ticket };
  }

  function appendServiceLog(ticket, text, author, type = 'comment') {
    return {
      ...ticket,
      workLog: [
        ...(ticket.workLog || []),
        { date: new Date().toISOString(), text, author, type },
      ],
    };
  }

  function findServiceTicketOr404(repairId, res) {
    const tickets = readServiceTickets();
    const ticket = tickets.find(item => item.id === repairId);
    if (!ticket) {
      res.status(404).json({ ok: false, error: 'Заявка на ремонт не найдена' });
      return null;
    }
    return ticket;
  }

  function getMechanicReferenceByUser(authUser) {
    const mechanic = resolveCurrentUserAsMechanic(authUser, {
      mechanics: readData('mechanics') || [],
      users: readData('users') || [],
    });
    if (!mechanic) return null;
    return {
      id: mechanic.mechanicId,
      name: mechanic.mechanicName,
      userId: mechanic.userId,
    };
  }

  function syncEquipmentStatusForService(ticket, newStatus) {
    if (!ticket?.equipmentId && !ticket?.inventoryNumber) return;

    const equipmentList = readData('equipment') || [];
    const matchedEquipmentIds = new Set(equipmentList
      .filter(item => equipmentMatchesServiceTicket(ticket, item, equipmentList))
      .map(item => String(item.id || '')));
    const lifecycle = reconcileEquipmentRentalProjection({
      equipmentList,
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      serviceTickets: readServiceTickets(),
      affectedEquipmentIds: matchedEquipmentIds,
      nowIso,
      author: 'Система',
      reason: `Статус сервисной заявки ${ticket.id}: ${newStatus}`,
    });
    const nextEquipment = lifecycle.nextEquipment;

    assertProductionSmokeFixtureMutationAllowed({
      action: 'service_update',
      existingList: equipmentList,
      nextList: nextEquipment,
    });
    if (lifecycle.changed) writeData('equipment', nextEquipment);
  }

  function persistServiceTicketUpdate(updatedTicket, author = 'Система', options = {}) {
    const tickets = readServiceTickets();
    const previous = tickets.find(ticket => ticket.id === updatedTicket.id) || null;
    const normalizedForWrite = normalizeServiceTicketForWrite(updatedTicket, {
      previous,
      isCreate: !previous,
      nowIso,
    });
    if (normalizedForWrite?.contractId) {
      assertClientContractAvailableForNewLink(readData, normalizedForWrite.contractId, {
        allowArchivedContractId: previous?.contractId,
      });
    }
    const normalized = canonicalizeServiceTicketCounterpartyRelation(
      normalizedForWrite,
      { readData },
      { existing: previous },
    );
    const nextTickets = tickets.map(ticket => ticket.id === normalized.id ? normalized : ticket);
    const equipmentList = readData('equipment') || [];
    const matchedEquipmentIds = new Set(equipmentList
      .filter(item => equipmentMatchesServiceTicket(normalized, item, equipmentList))
      .map(item => String(item.id || '')));
    const lifecycle = reconcileEquipmentRentalProjection({
      equipmentList,
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      serviceTickets: nextTickets,
      affectedEquipmentIds: matchedEquipmentIds,
      nowIso,
      author,
      reason: `Изменение сервисной заявки ${normalized.id}`,
    });
    const maintenanceField = normalized.status === 'closed'
      ? ({ chto: 'maintenanceCHTO', pto: 'maintenancePTO' })[normalized.serviceKind]
      : null;
    const maintenanceDate = nowIso().slice(0, 10);
    const nextEquipment = maintenanceField
      ? lifecycle.nextEquipment.map(item => (
          matchedEquipmentIds.has(String(item?.id || ''))
            ? { ...item, [maintenanceField]: maintenanceDate }
            : item
        ))
      : lifecycle.nextEquipment;
    const equipmentChanged = lifecycle.changed || nextEquipment.some((item, index) => item !== lifecycle.nextEquipment[index]);
    const persistence = servicePersistenceOptions(options, normalized, previous);
    persistence.write([
      { name: 'service', value: nextTickets },
      ...(equipmentChanged ? [{ name: 'equipment', value: nextEquipment }] : []),
      ...persistence.extraEntries,
    ]);
    return normalized;
  }

  function persistServiceTicketDeletion(ticket, author = 'Система', options = {}) {
    const nextTickets = readServiceTickets().filter(item => item.id !== ticket?.id);
    const equipmentList = readData('equipment') || [];
    const matchedEquipmentIds = new Set(equipmentList
      .filter(item => equipmentMatchesServiceTicket(ticket, item, equipmentList))
      .map(item => String(item.id || '')));
    const lifecycle = reconcileEquipmentRentalProjection({
      equipmentList,
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      serviceTickets: nextTickets,
      affectedEquipmentIds: matchedEquipmentIds,
      nowIso,
      author,
      reason: `Удаление сервисной заявки ${ticket?.id || ''}`,
    });
    const persistence = servicePersistenceOptions(options, ticket, ticket);
    persistence.write([
      { name: 'service', value: nextTickets },
      ...(lifecycle.changed ? [{ name: 'equipment', value: lifecycle.nextEquipment }] : []),
      ...persistence.extraEntries,
    ]);
  }

  function persistServiceTicketBulkReplace(tickets, author = 'Система', options = {}) {
    const previousTickets = readServiceTickets();
    const previousById = new Map(previousTickets.map(ticket => [String(ticket?.id || ''), ticket]));
    const normalizedTickets = (Array.isArray(tickets) ? tickets : []).map(ticket => normalizeServiceTicketForWrite(ticket, {
      previous: previousById.get(String(ticket?.id || '')) || null,
      isCreate: !previousById.has(String(ticket?.id || '')),
      nowIso,
    })).filter(Boolean);
    const nextTickets = canonicalizeServiceTicketCollection(normalizedTickets, { readData }, {
      existingTickets: previousTickets,
    });
    const equipmentList = readData('equipment') || [];
    const changedTickets = [...previousTickets, ...nextTickets];
    const affectedEquipmentIds = new Set(equipmentList
      .filter(item => changedTickets.some(ticket => equipmentMatchesServiceTicket(ticket, item, equipmentList)))
      .map(item => String(item.id || '')));
    const lifecycle = reconcileEquipmentRentalProjection({
      equipmentList,
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      serviceTickets: nextTickets,
      affectedEquipmentIds,
      nowIso,
      author,
      reason: 'Массовая замена сервисных заявок',
    });
    const persistence = servicePersistenceOptions(options, nextTickets, previousTickets);
    persistence.write([
      { name: 'service', value: nextTickets },
      ...(lifecycle.changed ? [{ name: 'equipment', value: lifecycle.nextEquipment }] : []),
      ...persistence.extraEntries,
    ]);
    return nextTickets;
  }

  function updateServiceTicketStatus(ticket, newStatus, author, text) {
    const updated = appendServiceLog({
      ...ticket,
      status: newStatus,
      closedAt: (newStatus === 'closed' || newStatus === 'ready') ? new Date().toISOString() : ticket.closedAt,
    }, text, author, 'status_change');
    return persistServiceTicketUpdate(updated, author);
  }

  function latestOpenRevision(ticket) {
    const history = Array.isArray(ticket?.revisionHistory) ? ticket.revisionHistory : [];
    return [...history].reverse().find(item => item && !item.resolvedAt) || null;
  }

  function returnServiceTicketForRevision(ticket, payload = {}, actor = {}, persistenceOptions = {}) {
    if (!['ready', 'closed'].includes(String(ticket?.status || ''))) {
      const error = new Error('Вернуть на доработку можно только готовую или закрытую заявку');
      error.status = 400;
      throw error;
    }
    const reason = String(payload.reason || '').trim();
    if (!reason) {
      const error = new Error('Укажите причину возврата на доработку');
      error.status = 400;
      throw error;
    }
    const mechanicId = String(ticket?.assignedMechanicId || ticket?.mechanicId || '').trim();
    const mechanicName = String(ticket?.assignedMechanicName || ticket?.assignedTo || '').trim();
    if (!mechanicId && !mechanicName) {
      const error = new Error('Нельзя вернуть заявку без назначенного механика');
      error.status = 400;
      throw error;
    }

    const now = nowIso();
    const checklist = Array.isArray(payload.checklist)
      ? payload.checklist.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    const details = String(payload.details || payload.comment || '').trim();
    const revision = {
      id: generateRevisionId(),
      createdAt: now,
      createdBy: actor.userId || actor.id || '',
      createdByName: actor.userName || actor.name || 'Оператор',
      assignedMechanicId: mechanicId,
      mechanicName,
      previousStatus: ticket.status || '',
      reason,
      checklist,
      details,
      resolvedAt: null,
      resolvedBy: null,
      resolvedByName: null,
      resolutionComment: '',
    };
    const checklistText = checklist.length ? ` (${checklist.join(', ')})` : '';
    const detailText = details ? `. Уточнить: ${details}` : '';
    const updated = appendServiceLog({
      ...ticket,
      status: 'needs_revision',
      revisionReason: reason,
      revisionDetails: details,
      revisionChecklist: checklist,
      revisionReturnedAt: now,
      revisionReturnedBy: revision.createdBy,
      revisionReturnedByName: revision.createdByName,
      revisionPreviousStatus: revision.previousStatus,
      revisionHistory: [
        ...(Array.isArray(ticket.revisionHistory) ? ticket.revisionHistory : []),
        revision,
      ],
    }, `Заявка возвращена механику на доработку: ${reason}${checklistText}${detailText}`, revision.createdByName, 'status_change');
    return persistServiceTicketUpdate(updated, revision.createdByName, persistenceOptions);
  }

  function resolveServiceTicketRevision(ticket, payload = {}, actor = {}, persistenceOptions = {}) {
    if (ticket?.status !== 'needs_revision') {
      const error = new Error('Повторно отправить можно только заявку в статусе «На доработке»');
      error.status = 400;
      throw error;
    }
    const now = nowIso();
    const comment = String(payload.resolutionComment || payload.comment || '').trim();
    const history = Array.isArray(ticket.revisionHistory) ? ticket.revisionHistory : [];
    const latest = latestOpenRevision(ticket);
    let resolved = false;
    const nextHistory = history.map(item => {
      if (resolved || item?.resolvedAt || item?.id !== latest?.id) return item;
      resolved = true;
      return {
        ...item,
        resolvedAt: now,
        resolvedBy: actor.userId || actor.id || '',
        resolvedByName: actor.userName || actor.name || 'Механик',
        resolutionComment: comment,
      };
    });
    if (!resolved && latest) {
      nextHistory.push({
        ...latest,
        resolvedAt: now,
        resolvedBy: actor.userId || actor.id || '',
        resolvedByName: actor.userName || actor.name || 'Механик',
        resolutionComment: comment,
      });
    }
    const updated = appendServiceLog({
      ...ticket,
      status: 'ready',
      revisionResolvedAt: now,
      revisionResolvedBy: actor.userId || actor.id || '',
      revisionResolvedByName: actor.userName || actor.name || 'Механик',
      revisionResolutionComment: comment,
      revisionHistory: nextHistory,
      closedAt: now,
    }, `Заявка повторно отправлена после доработки${comment ? `: ${comment}` : ''}`, actor.userName || actor.name || 'Механик', 'status_change');
    return persistServiceTicketUpdate(
      updated,
      actor.userName || actor.name || 'Механик',
      persistenceOptions,
    );
  }

  function generateRevisionId() {
    return `revision_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function getOpenTicketByEquipment(equipment) {
    const equipmentList = readData('equipment') || [];
    return readServiceTickets().find(ticket =>
      openServiceStatuses().includes(ticket.status) &&
      equipmentMatchesServiceTicket(ticket, equipment, equipmentList)
    ) || null;
  }

  return {
    serviceStatusLabel,
    servicePriorityLabel,
    openServiceStatuses,
    readServiceTickets,
    writeServiceTickets,
    findServiceTicketById,
    saveServiceTicket,
    appendServiceLog,
    findServiceTicketOr404,
    getMechanicReferenceByUser,
    applyServiceTicketCreationEffects,
    syncEquipmentStatusForService,
    persistServiceTicketUpdate,
    persistServiceTicketDeletion,
    persistServiceTicketBulkReplace,
    updateServiceTicketStatus,
    returnServiceTicketForRevision,
    resolveServiceTicketRevision,
    getOpenTicketByEquipment,
  };
}

module.exports = {
  createServiceCore,
};
