const OPEN_ENDED_DATE = '9999-12-31';

const CLOSED_RENTAL_STATUSES = new Set(['closed', 'returned', 'cancelled', 'canceled', 'completed']);
const DOWNTIME_STATUSES = new Set(['active', 'closed', 'cancelled']);

function text(value) {
  return String(value ?? '').trim();
}

function isSafeEquipmentInventoryRef(value) {
  const normalized = text(value);
  return Boolean(normalized && normalized !== '0' && normalized !== '-' && normalized !== '—');
}

function dateKey(value) {
  const raw = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function normalizeDowntimeStatus(value) {
  const status = text(value).toLowerCase();
  if (status === 'canceled') return 'cancelled';
  if (status === 'done' || status === 'completed') return 'closed';
  return DOWNTIME_STATUSES.has(status) ? status : 'active';
}

function rangeEnd(value) {
  return dateKey(value) || OPEN_ENDED_DATE;
}

function dateRangesOverlap(startA, endA, startB, endB) {
  const normalizedStartA = dateKey(startA);
  const normalizedStartB = dateKey(startB);
  if (!normalizedStartA || !normalizedStartB) return false;
  return normalizedStartA <= rangeEnd(endB) && normalizedStartB <= rangeEnd(endA);
}

function isClosedRentalStatus(status) {
  return CLOSED_RENTAL_STATUSES.has(text(status).toLowerCase());
}

function equipmentInventoryById(equipmentList, equipmentId) {
  if (!equipmentId) return '';
  const equipment = (equipmentList || []).find(item => text(item?.id) === text(equipmentId));
  return text(equipment?.inventoryNumber);
}

function normalizeEquipmentDowntimeRecord(input = {}, previous = null, context = {}) {
  const nowIso = typeof context.nowIso === 'function' ? context.nowIso : () => new Date().toISOString();
  const user = context.user || {};
  const previousRecord = previous && typeof previous === 'object' ? previous : {};
  const body = input && typeof input === 'object' ? input : {};
  const next = { ...previousRecord, ...body };
  const normalized = {
    ...next,
    equipmentId: text(next.equipmentId || previousRecord.equipmentId),
    equipmentInv: text(next.equipmentInv || next.inventoryNumber || previousRecord.equipmentInv || previousRecord.inventoryNumber),
    startDate: dateKey(next.startDate || previousRecord.startDate),
    endDate: dateKey(next.endDate),
    reason: text(next.reason || previousRecord.reason),
    comment: text(next.comment || previousRecord.comment),
    status: normalizeDowntimeStatus(next.status || previousRecord.status),
    updatedAt: nowIso(),
    updatedBy: text(user.userName || user.name || previousRecord.updatedBy),
  };

  if (!normalized.createdAt) normalized.createdAt = nowIso();
  if (!normalized.createdBy) normalized.createdBy = text(user.userName || user.name);
  if (normalized.status === 'closed' && !normalized.closedAt) normalized.closedAt = nowIso();
  if (normalized.status === 'cancelled' && !normalized.cancelledAt) normalized.cancelledAt = nowIso();
  if (normalized.endDate) {
    delete normalized.openEnded;
  }
  return normalized;
}

function downtimeEquipmentRefs(downtime, equipmentList = []) {
  const equipmentId = text(downtime?.equipmentId);
  const equipmentInv = text(downtime?.equipmentInv);
  const inventoryFromId = equipmentInventoryById(equipmentList, equipmentId);
  return {
    equipmentId,
    equipmentInv: equipmentInv || inventoryFromId,
  };
}

function rentalMatchesDowntime(rental, downtime, equipmentList = []) {
  const refs = downtimeEquipmentRefs(downtime, equipmentList);
  const rentalEquipmentId = text(rental?.equipmentId);
  const rentalEquipmentInv = text(rental?.equipmentInv || rental?.inventoryNumber);
  if (refs.equipmentId && rentalEquipmentId) return refs.equipmentId === rentalEquipmentId;
  if (!isSafeEquipmentInventoryRef(refs.equipmentInv)) return false;
  if (rentalEquipmentInv && !isSafeEquipmentInventoryRef(rentalEquipmentInv)) return false;
  if (refs.equipmentInv && rentalEquipmentInv && refs.equipmentInv === rentalEquipmentInv) return true;
  if (refs.equipmentInv && Array.isArray(rental?.equipment)) {
    return rental.equipment.map(text).includes(refs.equipmentInv);
  }
  if (refs.equipmentId && !rentalEquipmentId && refs.equipmentInv && Array.isArray(rental?.equipment)) {
    return rental.equipment.map(text).includes(refs.equipmentInv);
  }
  return false;
}

function downtimeMatchesDowntime(left, right, equipmentList = []) {
  const leftRefs = downtimeEquipmentRefs(left, equipmentList);
  const rightRefs = downtimeEquipmentRefs(right, equipmentList);
  if (leftRefs.equipmentId && rightRefs.equipmentId) return leftRefs.equipmentId === rightRefs.equipmentId;
  if (!isSafeEquipmentInventoryRef(leftRefs.equipmentInv) || !isSafeEquipmentInventoryRef(rightRefs.equipmentInv)) return false;
  return Boolean(leftRefs.equipmentInv && rightRefs.equipmentInv && leftRefs.equipmentInv === rightRefs.equipmentInv);
}

function rentalEndDate(rental) {
  return dateKey(rental?.plannedReturnDate || rental?.endDate || rental?.actualReturnDate);
}

function findRentalConflict(downtime, rentals, equipmentList = []) {
  return (rentals || []).find(rental => {
    if (isClosedRentalStatus(rental?.status)) return false;
    if (!rentalMatchesDowntime(rental, downtime, equipmentList)) return false;
    return dateRangesOverlap(
      downtime.startDate,
      downtime.endDate,
      rental?.startDate,
      rentalEndDate(rental),
    );
  }) || null;
}

function findDowntimeConflict(downtime, downtimes, equipmentList = [], excludeId = '') {
  const ownId = text(excludeId || downtime?.id);
  return (downtimes || []).find(item => {
    if (ownId && text(item?.id) === ownId) return false;
    if (normalizeDowntimeStatus(item?.status) === 'cancelled') return false;
    if (!downtimeMatchesDowntime(item, downtime, equipmentList)) return false;
    return dateRangesOverlap(downtime.startDate, downtime.endDate, item?.startDate, item?.endDate);
  }) || null;
}

function validateEquipmentDowntimePayload(input, context = {}) {
  const equipment = Array.isArray(context.equipment) ? context.equipment : [];
  const downtime = normalizeEquipmentDowntimeRecord(input, null, context);
  const refs = downtimeEquipmentRefs(downtime, equipment);

  if (!refs.equipmentId && !refs.equipmentInv) {
    return { ok: false, status: 400, error: 'Выберите технику для простоя.' };
  }
  if (!downtime.startDate) {
    return { ok: false, status: 400, error: 'Укажите дату начала простоя.' };
  }
  if (downtime.endDate && downtime.endDate < downtime.startDate) {
    return { ok: false, status: 400, error: 'Дата окончания простоя не может быть раньше даты начала.' };
  }
  if (!DOWNTIME_STATUSES.has(downtime.status)) {
    return { ok: false, status: 400, error: 'Укажите корректный статус простоя.' };
  }

  if (downtime.status === 'cancelled') {
    return { ok: true, downtime };
  }

  const allRentals = [
    ...(Array.isArray(context.rentals) ? context.rentals : []),
    ...(Array.isArray(context.ganttRentals) ? context.ganttRentals : []),
  ];
  const rentalConflict = findRentalConflict(downtime, allRentals, equipment);
  if (rentalConflict) {
    return {
      ok: false,
      status: 409,
      error: `Простой пересекается с активной арендой ${text(rentalConflict.id) || ''}. Измените даты или сначала закройте аренду.`,
    };
  }

  const downtimeConflict = findDowntimeConflict(
    downtime,
    Array.isArray(context.downtimes) ? context.downtimes : [],
    equipment,
    context.excludeId,
  );
  if (downtimeConflict) {
    return {
      ok: false,
      status: 409,
      error: `На эту технику уже есть простой ${text(downtimeConflict.id) || ''} в выбранном периоде.`,
    };
  }

  return { ok: true, downtime };
}

module.exports = {
  dateRangesOverlap,
  findDowntimeConflict,
  findRentalConflict,
  normalizeDowntimeStatus,
  normalizeEquipmentDowntimeRecord,
  validateEquipmentDowntimePayload,
};
