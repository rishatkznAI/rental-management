function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function normalizeGanttRentalStatus(rental, currentDay = todayKey()) {
  if (!rental) return rental;
  if (rental.status !== 'created') return rental;
  if (!rental.startDate) return rental;
  if (rental.startDate > currentDay) return rental;

  return {
    ...rental,
    status: 'active',
  };
}

function normalizeGanttRentalList(rentals, currentDay = todayKey()) {
  return (rentals || []).map((rental) => normalizeGanttRentalStatus(rental, currentDay));
}

module.exports = {
  normalizeGanttRentalList,
  normalizeGanttRentalStatus,
  todayKey,
};
