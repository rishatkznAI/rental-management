function text(value) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  if (!normalized || normalized === 'undefined' || normalized === 'null') return '';
  return normalized;
}

function lower(value) {
  return text(value).toLowerCase();
}

const STANDALONE_PLANNER_TYPES = new Set([
  'delivery',
  'shipping',
  'receiving',
  'service',
  'downtime',
  'maintenance',
  'reservation',
  'planner',
  'planner_event',
]);

function linkedRentalIds(ganttRental) {
  return [
    ganttRental?.rentalId,
    ganttRental?.sourceRentalId,
    ganttRental?.originalRentalId,
  ].map(text).filter(Boolean);
}

function isStandalonePlannerRow(ganttRental) {
  const id = text(ganttRental?.id);
  const linkedId = linkedRentalIds(ganttRental)[0] || '';
  const typeValues = [
    ganttRental?.sourceType,
    ganttRental?.operationType,
    ganttRental?.type,
    ganttRental?.kind,
    ganttRental?.plannerType,
  ].map(lower).filter(Boolean);

  return (
    id.startsWith('delivery:') ||
    id.startsWith('service:') ||
    linkedId.startsWith('delivery:') ||
    linkedId.startsWith('service:') ||
    typeValues.some(value => STANDALONE_PLANNER_TYPES.has(value))
  );
}

function ganttRentalLinkGuardError() {
  return {
    ok: false,
    status: 400,
    code: 'GANTT_RENTAL_WITHOUT_RENTAL',
    error: 'Запись планировщика типа rental должна быть связана с существующей арендой',
  };
}

function validateGanttRentalLinkRequirement(ganttRental, rentals = []) {
  if (isStandalonePlannerRow(ganttRental)) return { ok: true };

  const ids = linkedRentalIds(ganttRental);
  if (ids.length === 0) return ganttRentalLinkGuardError();

  const rentalsById = new Set((rentals || []).map(rental => text(rental?.id)).filter(Boolean));
  if (!ids.some(id => rentalsById.has(id))) return ganttRentalLinkGuardError();

  return { ok: true };
}

module.exports = {
  linkedRentalIds,
  isStandalonePlannerRow,
  validateGanttRentalLinkRequirement,
};
