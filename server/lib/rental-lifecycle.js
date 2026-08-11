const { rentalMatchesEquipment } = require('./rental-validation');

const TERMINAL_RENTAL_STATUSES = new Set([
  'closed',
  'returned',
  'cancelled',
  'canceled',
  'completed',
]);
const OPEN_SERVICE_STATUSES = new Set([
  'new',
  'in_progress',
  'waiting_parts',
  'needs_revision',
]);
const CLOSED_DOWNTIME_STATUSES = new Set(['closed', 'cancelled', 'canceled', 'completed']);
const RENTAL_PROJECTED_EQUIPMENT_STATUSES = new Set(['available', 'rented', 'reserved', 'in_service']);

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function dateKey(value) {
  return text(value).slice(0, 10);
}

function rentalEndDate(rental) {
  return dateKey(rental?.plannedReturnDate || rental?.endDate || rental?.returnDate);
}

function rentalStartDate(rental) {
  return dateKey(rental?.startDate);
}

function isTerminalRental(rental) {
  return Boolean(rental?.actualReturnDate) || TERMINAL_RENTAL_STATUSES.has(lower(rental?.status));
}

function isOpenServiceTicket(ticket) {
  return OPEN_SERVICE_STATUSES.has(lower(ticket?.status));
}

function dateRangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && startB <= endA;
}

function equipmentMatchesRecord(record, equipment, equipmentList) {
  return Boolean(record && equipment && rentalMatchesEquipment(record, equipment, equipmentList || []));
}

function serviceTicketMatchesEquipment(ticket, equipment) {
  if (!ticket || !equipment) return false;
  if (text(ticket.equipmentId) && text(ticket.equipmentId) === text(equipment.id)) return true;
  if (text(ticket.serialNumber) && text(equipment.serialNumber) && text(ticket.serialNumber) === text(equipment.serialNumber)) return true;
  return Boolean(
    text(ticket.inventoryNumber)
    && text(equipment.inventoryNumber)
    && text(ticket.inventoryNumber) === text(equipment.inventoryNumber)
  );
}

function downtimeMatchesEquipment(downtime, equipment) {
  if (!downtime || !equipment) return false;
  if (text(downtime.equipmentId) && text(downtime.equipmentId) === text(equipment.id)) return true;
  if (text(downtime.serialNumber) && text(equipment.serialNumber) && text(downtime.serialNumber) === text(equipment.serialNumber)) return true;
  return Boolean(
    text(downtime.equipmentInv || downtime.inventoryNumber)
    && text(equipment.inventoryNumber)
    && text(downtime.equipmentInv || downtime.inventoryNumber) === text(equipment.inventoryNumber)
  );
}

function findEquipmentForRental(rental, equipmentList) {
  return (equipmentList || []).find(equipment => equipmentMatchesRecord(rental, equipment, equipmentList)) || null;
}

function authoritativeRentalCandidates(rentals) {
  // Classic rentals are the contractual authority. Gantt rows are projections only:
  // a missing, stale or orphan projection must never create lifecycle authority.
  return Array.isArray(rentals) ? rentals : [];
}

function rentalProjectionRank(rental, today) {
  const start = rentalStartDate(rental);
  const end = rentalEndDate(rental);
  if (start && end && start <= today && end >= today) return 0;
  if (lower(rental?.status) === 'active') return 1;
  if (start && start > today) return 2;
  return 3;
}

function selectRentalProjection(equipment, rentals, ganttRentals, equipmentList, today) {
  const candidates = authoritativeRentalCandidates(rentals)
    .filter(rental => !isTerminalRental(rental))
    .filter(rental => equipmentMatchesRecord(rental, equipment, equipmentList))
    .sort((left, right) => {
      const rankDifference = rentalProjectionRank(left, today) - rentalProjectionRank(right, today);
      if (rankDifference !== 0) return rankDifference;
      return rentalStartDate(left).localeCompare(rentalStartDate(right));
    });
  const rental = candidates[0] || null;
  if (!rental) return null;
  const rank = rentalProjectionRank(rental, today);
  return {
    rental,
    status: rank <= 1 ? 'rented' : 'reserved',
    currentClient: rental.client || rental.clientName || '',
    returnDate: rentalEndDate(rental),
  };
}

function equipmentProjectionForState({
  equipment,
  equipmentList,
  rentals,
  ganttRentals,
  serviceTickets,
  today,
}) {
  if (lower(equipment?.status) === 'inactive' || equipment?.activeInFleet === false) {
    return {
      status: equipment.status,
      currentClient: equipment.currentClient,
      returnDate: equipment.returnDate,
      source: 'inactive',
      rental: null,
    };
  }
  const openServiceTicket = (serviceTickets || []).find(ticket => (
    isOpenServiceTicket(ticket) && serviceTicketMatchesEquipment(ticket, equipment)
  )) || null;
  if (openServiceTicket) {
    return {
      status: 'in_service',
      currentClient: undefined,
      returnDate: undefined,
      source: 'service',
      serviceTicket: openServiceTicket,
      rental: null,
    };
  }
  const rentalProjection = selectRentalProjection(
    equipment,
    rentals,
    ganttRentals,
    equipmentList,
    today,
  );
  if (rentalProjection) {
    return { ...rentalProjection, source: 'rental' };
  }
  return {
    status: RENTAL_PROJECTED_EQUIPMENT_STATUSES.has(lower(equipment?.status)) ? 'available' : equipment.status,
    currentClient: undefined,
    returnDate: undefined,
    source: 'available',
    rental: null,
  };
}

function projectionChanged(equipment, projection) {
  return lower(equipment?.status) !== lower(projection?.status)
    || text(equipment?.currentClient) !== text(projection?.currentClient)
    || dateKey(equipment?.returnDate) !== dateKey(projection?.returnDate);
}

function reconcileEquipmentRentalProjection({
  equipmentList = [],
  rentals = [],
  ganttRentals = [],
  serviceTickets = [],
  affectedEquipmentIds = null,
  nowIso = () => new Date().toISOString(),
  author = 'Система',
  reason = 'Синхронизация жизненного цикла аренды',
} = {}) {
  const timestamp = nowIso();
  const today = dateKey(timestamp);
  const affected = affectedEquipmentIds
    ? new Set([...affectedEquipmentIds].map(text).filter(Boolean))
    : null;
  const changedEquipmentIds = [];
  const nextEquipment = (equipmentList || []).map((equipment) => {
    if (affected && !affected.has(text(equipment?.id))) return equipment;
    const projection = equipmentProjectionForState({
      equipment,
      equipmentList,
      rentals,
      ganttRentals,
      serviceTickets,
      today,
    });
    if (!projectionChanged(equipment, projection)) return equipment;
    changedEquipmentIds.push(text(equipment.id));
    return {
      ...equipment,
      status: projection.status,
      currentClient: projection.currentClient || undefined,
      returnDate: projection.returnDate || undefined,
      history: [
        ...(Array.isArray(equipment.history) ? equipment.history : []),
        {
          date: timestamp,
          text: `${reason}: ${equipment.status || '—'} → ${projection.status || '—'}`,
          author,
          type: 'system',
        },
      ],
    };
  });
  return {
    nextEquipment,
    changed: changedEquipmentIds.length > 0,
    changedEquipmentIds,
  };
}

function affectedEquipmentIdsForRentals(rentals, equipmentList) {
  const ids = new Set();
  for (const rental of rentals || []) {
    const equipment = findEquipmentForRental(rental, equipmentList);
    if (equipment?.id) ids.add(text(equipment.id));
  }
  return ids;
}

function lifecycleConflict(message, options = {}) {
  return {
    ok: false,
    status: options.status || 409,
    code: options.code || 'RENTAL_LIFECYCLE_CONFLICT',
    error: message,
    field: options.field || 'equipmentId',
    fieldErrors: options.fieldErrors || { [options.field || 'equipmentId']: message },
  };
}

function validateTerminalRentalTransition(previousRental, nextRental) {
  if (!isTerminalRental(previousRental)) return { ok: true };
  if (!TERMINAL_RENTAL_STATUSES.has(lower(nextRental?.status))) {
    return lifecycleConflict('Завершённую аренду нельзя вернуть в активный lifecycle без отдельного recovery-процесса.', {
      code: 'RENTAL_TERMINAL_RESURRECTION_FORBIDDEN',
      field: 'status',
    });
  }
  if (dateKey(previousRental?.actualReturnDate) && !dateKey(nextRental?.actualReturnDate)) {
    return lifecycleConflict('Фактическую дату возврата завершённой аренды нельзя удалить обычной lifecycle-операцией.', {
      code: 'RENTAL_TERMINAL_RESURRECTION_FORBIDDEN',
      field: 'actualReturnDate',
    });
  }
  return { ok: true };
}

function validateRentalLifecycleAvailability({
  rental,
  equipmentList = [],
  serviceTickets = [],
  equipmentDowntimes = [],
} = {}) {
  if (!rental || isTerminalRental(rental)) return { ok: true };
  const equipment = findEquipmentForRental(rental, equipmentList);
  if (!equipment) {
    return lifecycleConflict('Не удалось однозначно определить технику для аренды.', {
      code: 'RENTAL_EQUIPMENT_NOT_FOUND',
    });
  }
  if (lower(equipment.status) === 'inactive' || equipment.activeInFleet === false) {
    return lifecycleConflict('Техника списана или исключена из активного парка.', {
      code: 'RENTAL_EQUIPMENT_INACTIVE',
    });
  }
  const openServiceTicket = (serviceTickets || []).find(ticket => (
    isOpenServiceTicket(ticket) && serviceTicketMatchesEquipment(ticket, equipment)
  ));
  if (openServiceTicket || lower(equipment.status) === 'in_service') {
    const message = openServiceTicket
      ? `Техника находится в сервисе по заявке ${openServiceTicket.id}.`
      : 'Техника находится в сервисе.';
    return lifecycleConflict(message, { code: 'RENTAL_EQUIPMENT_IN_SERVICE' });
  }
  const start = rentalStartDate(rental);
  const end = rentalEndDate(rental);
  const downtime = (equipmentDowntimes || []).find(item => (
    !CLOSED_DOWNTIME_STATUSES.has(lower(item?.status))
    && downtimeMatchesEquipment(item, equipment)
    && dateRangesOverlap(start, end, dateKey(item?.startDate), dateKey(item?.endDate || item?.startDate))
  ));
  if (downtime) {
    return lifecycleConflict(`На выбранный период у техники запланирован простой ${downtime.id || ''}.`.trim(), {
      code: 'RENTAL_EQUIPMENT_DOWNTIME_CONFLICT',
      field: 'startDate',
      fieldErrors: {
        startDate: 'Период аренды пересекается с простоем техники.',
        plannedReturnDate: 'Период аренды пересекается с простоем техники.',
      },
    });
  }
  return { ok: true, equipment };
}

module.exports = {
  OPEN_SERVICE_STATUSES,
  TERMINAL_RENTAL_STATUSES,
  affectedEquipmentIdsForRentals,
  dateRangesOverlap,
  equipmentProjectionForState,
  findEquipmentForRental,
  isOpenServiceTicket,
  isTerminalRental,
  reconcileEquipmentRentalProjection,
  selectRentalProjection,
  serviceTicketMatchesEquipment,
  validateRentalLifecycleAvailability,
  validateTerminalRentalTransition,
};
