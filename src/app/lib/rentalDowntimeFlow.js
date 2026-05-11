const CLOSED_RENTAL_STATUSES = new Set(['closed', 'returned', 'completed', 'cancelled', 'canceled']);

function text(value) {
  return String(value ?? '').trim();
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
  const downtimeEquipmentInv = text(downtime?.equipmentInv || downtime?.inventoryNumber);
  const rentalEquipmentId = text(rental?.equipmentId);
  const rentalEquipmentInv = text(rental?.equipmentInv || rental?.inventoryNumber);
  if (downtimeEquipmentId && rentalEquipmentId && downtimeEquipmentId === rentalEquipmentId) return true;
  if (downtimeEquipmentInv && rentalEquipmentInv && downtimeEquipmentInv === rentalEquipmentInv) return true;
  if (downtimeEquipmentInv && Array.isArray(rental?.equipment)) {
    return rental.equipment.map(text).includes(downtimeEquipmentInv);
  }
  return false;
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
  if (matches.length > 1) {
    return {
      flow: 'conflict',
      matches,
      message: 'Найдено несколько аренд в выбранном периоде. Откройте нужную аренду и скорректируйте простой там.',
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
  const details = [
    period ? `период ${period}` : '',
    comment,
  ].filter(Boolean).join('; ');
  return {
    downtimeDays: getDowntimeRentalDays(downtime?.startDate, downtime?.endDate),
    downtimeReason: details ? `${reason} (${details})` : reason,
  };
}

export function buildRentalDowntimeChangeReason(downtime, rental) {
  const equipment = text(downtime?.equipmentInv || rental?.equipmentInv || rental?.equipment?.[0]);
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
