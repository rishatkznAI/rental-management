const { createAuditEntry } = require('./audit-history');
const { isUniqueInventoryNumber } = require('./equipment-matching');

function createServiceCore(deps) {
  const {
    readData,
    writeData,
    nowIso,
    equipmentMatchesServiceTicket,
  } = deps;

  function serviceStatusLabel(status) {
    return ({
      new: 'Новый',
      in_progress: 'В работе',
      waiting_parts: 'Ожидание запчастей',
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
    return ['new', 'in_progress', 'waiting_parts'];
  }

  function readServiceTickets() {
    return readData('service') || [];
  }

  function writeServiceTickets(tickets) {
    writeData('service', tickets);
  }

  function findServiceTicketById(ticketId) {
    const normalizedId = String(ticketId || '').trim().toLowerCase();
    return readServiceTickets().find(ticket => String(ticket.id || '').trim().toLowerCase() === normalizedId) || null;
  }

  function saveServiceTicket(updatedTicket) {
    const tickets = readServiceTickets();
    const nextTickets = tickets.map(ticket => ticket.id === updatedTicket.id ? updatedTicket : ticket);
    writeServiceTickets(nextTickets);
  }

  function applyServiceTicketCreationEffects(ticket, author = 'Система') {
    if (!ticket) return;

    const equipmentList = readData('equipment') || [];
    const ganttRentals = readData('gantt_rentals') || [];
    const todayStr = nowIso().slice(0, 10);
    const auditText = `Техника переведена в сервис по заявке ${ticket.id}: ${ticket.reason || 'Без причины'}`;

    const nextEquipment = equipmentList.map(item => {
      if (!equipmentMatchesServiceTicket(ticket, item, equipmentList)) return item;
      return {
        ...item,
        status: 'in_service',
        currentClient: undefined,
        returnDate: undefined,
        history: [
          ...(Array.isArray(item.history) ? item.history : []),
          createAuditEntry(author, auditText),
        ],
      };
    });

    const nextRentals = ganttRentals.map(rental => {
      const matchesEquipment =
        (ticket.equipmentId && rental.equipmentId === ticket.equipmentId)
        || (!rental.equipmentId && ticket.inventoryNumber && rental.equipmentInv === ticket.inventoryNumber);

      const isActiveToday =
        rental.status === 'active'
        && rental.startDate <= todayStr
        && rental.endDate >= todayStr;

      if (!matchesEquipment || !isActiveToday) return rental;

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

    writeData('equipment', nextEquipment);
    writeData('gantt_rentals', nextRentals);
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
    const mechanics = readData('mechanics') || [];
    const targetName = String(authUser?.userName || '').trim().toLowerCase();
    return mechanics.find(item => item.status === 'active' && String(item.name || '').trim().toLowerCase() === targetName) || null;
  }

  function syncEquipmentStatusForService(ticket, newStatus) {
    if (!ticket?.equipmentId && !ticket?.inventoryNumber) return;

    const equipmentList = readData('equipment') || [];
    const ganttRentals = readData('gantt_rentals') || [];
    const tickets = readServiceTickets();
    const openStatuses = openServiceStatuses();
    const ticketInventoryIsUnique = ticket.inventoryNumber
      ? isUniqueInventoryNumber(ticket.inventoryNumber, equipmentList)
      : false;

    const remainingOpen = tickets.some(existing =>
      existing.id !== ticket.id &&
      openStatuses.includes(existing.status) &&
      (
        (ticket.equipmentId && existing.equipmentId === ticket.equipmentId) ||
        (ticket.serialNumber && existing.serialNumber === ticket.serialNumber) ||
        (ticket.inventoryNumber && ticketInventoryIsUnique && existing.inventoryNumber === ticket.inventoryNumber)
      )
    );

    const hasActiveRental = ganttRentals.some(rental =>
      (
        (ticket.equipmentId && rental.equipmentId === ticket.equipmentId) ||
        (!rental.equipmentId && ticket.inventoryNumber && ticketInventoryIsUnique && rental.equipmentInv === ticket.inventoryNumber)
      ) &&
      rental.status !== 'returned' &&
      rental.status !== 'closed'
    );

    // IMPORTANT: equipment status is derived from the service/rental state. Closing one
    // ticket must not mark equipment available while another open ticket or rental blocks it.
    const nextEquipment = equipmentList.map(item => {
      const matches =
        (ticket.equipmentId && item.id === ticket.equipmentId) ||
        (ticket.serialNumber && item.serialNumber === ticket.serialNumber) ||
        (ticket.inventoryNumber && ticketInventoryIsUnique && item.inventoryNumber === ticket.inventoryNumber);
      if (!matches) return item;

      let nextStatus = item.status;
      if (openStatuses.includes(newStatus)) {
        nextStatus = 'in_service';
      } else if (!remainingOpen) {
        nextStatus = hasActiveRental ? 'rented' : 'available';
      }
      return { ...item, status: nextStatus };
    });

    writeData('equipment', nextEquipment);
  }

  function updateServiceTicketStatus(ticket, newStatus, author, text) {
    const updated = appendServiceLog({
      ...ticket,
      status: newStatus,
      closedAt: (newStatus === 'closed' || newStatus === 'ready') ? new Date().toISOString() : ticket.closedAt,
    }, text, author, 'status_change');
    saveServiceTicket(updated);
    syncEquipmentStatusForService(updated, newStatus);
    return updated;
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
    updateServiceTicketStatus,
    getOpenTicketByEquipment,
  };
}

module.exports = {
  createServiceCore,
};
