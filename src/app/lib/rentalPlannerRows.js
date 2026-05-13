function text(value) {
  return String(value ?? '').trim();
}

export function getGanttRentalSourceId(ganttRental) {
  return text(
    ganttRental?.rentalId ||
    ganttRental?.sourceRentalId ||
    ganttRental?.originalRentalId ||
    ''
  );
}

export function getGanttRentalCanonicalId(ganttRental, rentalsById = new Map()) {
  const sourceId = getGanttRentalSourceId(ganttRental);
  if (sourceId) return sourceId;
  const fallbackId = text(ganttRental?.id);
  return fallbackId && rentalsById.has(fallbackId) ? fallbackId : '';
}

const STATUS_PRIORITY = new Map([
  ['active', 0],
  ['confirmed', 1],
  ['delivery', 2],
  ['created', 3],
  ['returned', 4],
  ['closed', 5],
  ['cancelled', 6],
  ['canceled', 6],
]);

function statusRank(ganttRental) {
  const status = text(ganttRental?.status).toLowerCase();
  return STATUS_PRIORITY.has(status) ? STATUS_PRIORITY.get(status) : 99;
}

function dateValue(value) {
  const raw = text(value).slice(0, 10);
  if (!raw) return 0;
  const timestamp = new Date(`${raw}T00:00:00.000Z`).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isCurrent(ganttRental, todayKey) {
  const start = text(ganttRental?.startDate).slice(0, 10);
  const end = text(ganttRental?.endDate || ganttRental?.plannedReturnDate).slice(0, 10);
  return Boolean(start && end && start <= todayKey && todayKey <= end);
}

function recencyValue(ganttRental) {
  return Math.max(
    dateValue(ganttRental?.updatedAt),
    dateValue(ganttRental?.createdAt),
    dateValue(ganttRental?.endDate || ganttRental?.plannedReturnDate),
    dateValue(ganttRental?.startDate),
  );
}

export function compareGanttRentalPriority(left, right, { todayKey = '' } = {}) {
  const byStatus = statusRank(left) - statusRank(right);
  if (byStatus !== 0) return byStatus;

  if (todayKey) {
    const leftCurrent = isCurrent(left, todayKey);
    const rightCurrent = isCurrent(right, todayKey);
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
  }

  const byRecency = recencyValue(right) - recencyValue(left);
  if (byRecency !== 0) return byRecency;

  return text(left?.id).localeCompare(text(right?.id));
}

export function chooseBestGanttRentalEntry(entries, options = {}) {
  return [...(entries || [])].sort((left, right) => compareGanttRentalPriority(left, right, options))[0] || null;
}

function duplicateMeta(entries, canonicalRentalId) {
  return {
    __canonicalRentalId: canonicalRentalId,
    __duplicateGanttCount: entries.length,
    __duplicateGanttIds: entries.map(item => text(item?.id)).filter(Boolean),
  };
}

export function buildRentalPlannerRows({ ganttRentals = [], rentals = [], todayKey = '' } = {}) {
  const rentalList = Array.isArray(rentals) ? rentals : [];
  const ganttList = Array.isArray(ganttRentals) ? ganttRentals : [];
  const rentalsById = new Map(rentalList.map(item => [text(item?.id), item]).filter(([id]) => id));
  const linkedGroups = new Map();
  const orphanPlannerRows = [];

  for (const ganttRental of ganttList) {
    const canonicalRentalId = getGanttRentalCanonicalId(ganttRental, rentalsById);
    if (!canonicalRentalId || !rentalsById.has(canonicalRentalId)) {
      orphanPlannerRows.push(ganttRental);
      continue;
    }
    if (!linkedGroups.has(canonicalRentalId)) linkedGroups.set(canonicalRentalId, []);
    linkedGroups.get(canonicalRentalId).push(ganttRental);
  }

  const duplicateGroups = [];
  const duplicateCountByRentalId = new Map();
  const rentalRows = [];

  for (const [canonicalRentalId, entries] of linkedGroups.entries()) {
    duplicateCountByRentalId.set(canonicalRentalId, entries.length);
    if (entries.length > 1) {
      duplicateGroups.push({
        rentalId: canonicalRentalId,
        count: entries.length,
        ids: entries.map(item => text(item?.id)).filter(Boolean),
      });
    }
    const best = chooseBestGanttRentalEntry(entries, { todayKey });
    if (best) {
      rentalRows.push({
        ...best,
        ...duplicateMeta(entries, canonicalRentalId),
      });
    }
  }

  return {
    rentalRows,
    orphanPlannerRows,
    duplicateGroups,
    duplicateCountByRentalId,
    rentalsById,
  };
}

export function isLinkedRentalRow(ganttRental, rentalsById = new Map()) {
  const canonicalRentalId = getGanttRentalCanonicalId(ganttRental, rentalsById);
  return Boolean(canonicalRentalId && rentalsById.has(canonicalRentalId));
}
