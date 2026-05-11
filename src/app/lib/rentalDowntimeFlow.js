const CLOSED_RENTAL_STATUSES = new Set(['closed', 'returned', 'completed', 'cancelled', 'canceled']);
const RENTAL_FLOW_STATUS_PRIORITY = {
  active: 5,
  confirmed: 4,
  delivery: 3,
  created: 2,
};

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

function parseDateOnly(value) {
  return new Date(`${value}T00:00:00`);
}

export function getDowntimeRentalDays(startDate, endDate) {
  const start = dateKey(startDate);
  const end = dateKey(endDate) || start;
  if (!start || !end || end < start) return 0;
  const diffMs = parseDateOnly(end).getTime() - parseDateOnly(start).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export function dateRangesOverlapInclusive(startA, endA, startB, endB) {
  const normalizedStartA = dateKey(startA);
  const normalizedStartB = dateKey(startB);
  const normalizedEndA = dateKey(endA) || normalizedStartA;
  const normalizedEndB = dateKey(endB) || normalizedStartB;
  if (!normalizedStartA || !normalizedStartB || !normalizedEndA || !normalizedEndB) return false;
  return normalizedStartA <= normalizedEndB && normalizedStartB <= normalizedEndA;
}

export function isOpenRentalForDowntime(rental) {
  const status = text(rental?.status).toLowerCase();
  return !CLOSED_RENTAL_STATUSES.has(status) && !rental?.actualReturnDate;
}

export function rentalMatchesDowntimeEquipment(rental, downtime) {
  const downtimeEquipmentId = text(downtime?.equipmentId);
  const rentalEquipmentId = text(rental?.equipmentId);
  if (downtimeEquipmentId && rentalEquipmentId) return downtimeEquipmentId === rentalEquipmentId;

  const downtimeSerialNumber = text(downtime?.serialNumber);
  const rentalSerialNumber = text(rental?.serialNumber);
  if (downtimeSerialNumber && rentalSerialNumber) return downtimeSerialNumber === rentalSerialNumber;

  const downtimeEquipmentInv = text(downtime?.equipmentInv || downtime?.inventoryNumber);
  const rentalEquipmentInv = text(rental?.equipmentInv || rental?.inventoryNumber);
  if (!isSafeEquipmentInventoryRef(downtimeEquipmentInv)) return false;
  if (rentalEquipmentInv && !isSafeEquipmentInventoryRef(rentalEquipmentInv)) return false;
  if (downtimeEquipmentInv && rentalEquipmentInv && downtimeEquipmentInv === rentalEquipmentInv) return true;
  if (downtimeEquipmentInv && Array.isArray(rental?.equipment)) {
    return rental.equipment.map(text).includes(downtimeEquipmentInv);
  }
  return false;
}

export function canonicalDowntimeRentalId(rental) {
  return text(rental?.rentalId)
    || text(rental?.sourceRentalId)
    || text(rental?.originalRentalId)
    || text(rental?.id);
}

function rentalFlowStatusPriority(rental) {
  const status = text(rental?.status).toLowerCase();
  return RENTAL_FLOW_STATUS_PRIORITY[status] || 1;
}

export function chooseBestDowntimeRentalMatch(matches) {
  return [...(Array.isArray(matches) ? matches : [])].sort((left, right) =>
    rentalFlowStatusPriority(right) - rentalFlowStatusPriority(left),
  )[0] || null;
}

function groupMatchesByCanonicalRental(matches) {
  const groups = new Map();
  for (const rental of matches) {
    const key = canonicalDowntimeRentalId(rental);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(rental);
    groups.set(key, group);
  }
  return groups;
}

export function findDowntimeRentalFlowTarget({ downtime, rentals }) {
  const matches = (Array.isArray(rentals) ? rentals : [])
    .filter(rental => isOpenRentalForDowntime(rental))
    .filter(rental => rentalMatchesDowntimeEquipment(rental, downtime))
    .filter(rental => dateRangesOverlapInclusive(
      downtime?.startDate,
      downtime?.endDate || downtime?.startDate,
      rental?.startDate,
      rental?.endDate || rental?.plannedReturnDate,
    ));

  if (matches.length === 1) {
    return { flow: 'rental', rental: matches[0], matches };
  }

  const matchGroups = groupMatchesByCanonicalRental(matches);

  if (matchGroups.size === 1) {
    const groupedMatches = [...matchGroups.values()][0];
    return {
      flow: 'rental',
      rental: chooseBestDowntimeRentalMatch(groupedMatches),
      matches,
    };
  }
  if (matches.length > 1) {
    return {
      flow: 'conflict',
      matches,
      message: 'Найдено несколько разных аренд в выбранном периоде. Откройте нужную аренду и скорректируйте простой там.',
    };
  }
  return { flow: 'standalone', rental: null, matches: [] };
}

export function formatDowntimePeriod(startDate, endDate) {
  const start = dateKey(startDate);
  const end = dateKey(endDate) || start;
  if (!start) return '';
  return end && end !== start ? `${start} → ${end}` : start;
}

export function buildRentalDowntimePatch(downtime) {
  const reason = text(downtime?.reason) || 'Простой техники';
  const comment = text(downtime?.comment);
  const period = formatDowntimePeriod(downtime?.startDate, downtime?.endDate);
  const status = text(downtime?.status) || 'active';
  const details = [
    period ? `период ${period}` : '',
    comment,
  ].filter(Boolean).join('; ');
  return {
    downtimeDays: status === 'cancelled' ? 0 : getDowntimeRentalDays(downtime?.startDate, downtime?.endDate),
    downtimeReason: details ? `${reason} (${details})` : reason,
    downtimeStartDate: dateKey(downtime?.startDate),
    downtimeEndDate: dateKey(downtime?.endDate) || dateKey(downtime?.startDate),
    downtimeComment: comment,
    downtimeStatus: status,
  };
}

export function buildRentalDowntimeChangeReason(downtime, rental) {
  const equipment = text(downtime?.serialNumber || rental?.serialNumber || downtime?.equipmentInv || rental?.equipmentInv || rental?.equipment?.[0]);
  const period = formatDowntimePeriod(downtime?.startDate, downtime?.endDate);
  const reason = text(downtime?.reason) || 'причина не указана';
  const comment = text(downtime?.comment);
  return [
    `Простой техники${equipment ? ` ${equipment}` : ''}${period ? `: ${period}` : ''}`,
    reason,
    comment,
  ].filter(Boolean).join('. ');
}

export function downtimeSaveErrorMessage(error) {
  const message = text(error?.message);
  if (!message || /^HTTP\s+\d+$/i.test(message) || /validation failed/i.test(message)) {
    return 'Не удалось сохранить простой. Проверьте технику, даты и пересечения с арендой.';
  }
  return message;
}
