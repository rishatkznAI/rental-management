function text(value) {
  return String(value ?? '').trim();
}

function hasRentalId(rentalsById, id) {
  const normalized = text(id);
  return normalized && rentalsById.has(normalized);
}

function resolveFromGantt(ganttRental, rentalsById) {
  if (!ganttRental) return null;
  for (const candidate of [ganttRental.rentalId, ganttRental.sourceRentalId, ganttRental.originalRentalId]) {
    const id = text(candidate);
    if (hasRentalId(rentalsById, id)) return id;
  }
  return null;
}

export function resolveRentalNavigationId(rentalLike, rentals = [], ganttRentals = []) {
  if (!rentalLike) return null;

  const rentalsById = new Map(
    (Array.isArray(rentals) ? rentals : [])
      .map(rental => [text(rental?.id), rental])
      .filter(([id]) => Boolean(id)),
  );

  for (const candidate of [rentalLike.id, rentalLike.rentalId, rentalLike.sourceRentalId, rentalLike.originalRentalId]) {
    const id = text(candidate);
    if (hasRentalId(rentalsById, id)) return id;
  }

  const ganttById = new Map(
    (Array.isArray(ganttRentals) ? ganttRentals : [])
      .map(ganttRental => [text(ganttRental?.id), ganttRental])
      .filter(([id]) => Boolean(id)),
  );

  for (const candidate of [rentalLike.ganttRentalId, rentalLike.linkedGanttRentalId, rentalLike.id]) {
    const id = text(candidate);
    const resolved = resolveFromGantt(ganttById.get(id), rentalsById);
    if (resolved) return resolved;
  }

  return null;
}
