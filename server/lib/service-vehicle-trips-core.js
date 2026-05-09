const VEHICLE_TRIP_STATUSES = new Set(['draft', 'issued', 'in_progress', 'completed', 'cancelled']);

function tripError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeTripText(value) {
  return String(value ?? '').trim();
}

function normalizeTripDate(value) {
  const text = normalizeTripText(value);
  if (!text) return '';
  const parsed = new Date(`${text.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function parseTripNumber(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw tripError('Заполните пробег для закрытия путевого листа');
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw tripError('Пробег и топливо должны быть числами больше или равными нулю');
  }
  return numeric;
}

function findServiceVehicle(vehicleId, vehicles = []) {
  const id = normalizeTripText(vehicleId);
  return vehicles.find(vehicle => vehicle?.id === id) || null;
}

function buildTripRoute(input, previous = {}) {
  const routeFrom = normalizeTripText(input.routeFrom ?? previous.routeFrom);
  const routeTo = normalizeTripText(input.routeTo ?? previous.routeTo);
  const route = normalizeTripText(input.route ?? previous.route);
  if (routeFrom || routeTo) return { routeFrom, routeTo, route: [routeFrom, routeTo].filter(Boolean).join(' — ') };
  return { routeFrom: '', routeTo: '', route };
}

function getTripSheetNumber(input, vehicleId, existingTrips, previous = null, date = new Date()) {
  const value = normalizeTripText(input.sheetNumber ?? previous?.sheetNumber);
  if (value) return value;
  const nextNumber = existingTrips.filter(trip => trip.vehicleId === vehicleId && trip.id !== previous?.id).length + 1;
  return `${date.getFullYear()}-${String(nextNumber).padStart(4, '0')}`;
}

function assertTripSheetNumberUnique(trips, candidate, vehicleId, id = '') {
  const conflict = trips.find(trip =>
    trip.vehicleId === vehicleId &&
    trip.id !== id &&
    normalizeTripText(trip.sheetNumber).toLowerCase() === normalizeTripText(candidate).toLowerCase()
  );
  if (conflict) throw tripError('Номер путевого листа уже используется для этой машины', 409);
}

function normalizeVehicleTripPayload(body, {
  previous = null,
  userName = '',
  trips = [],
  vehicles = [],
  nowIso = () => new Date().toISOString(),
  generateId = prefix => `${prefix}-${Date.now()}`,
  idPrefix = 'VT',
} = {}) {
  const vehicleId = normalizeTripText(body.vehicleId ?? previous?.vehicleId);
  if (!vehicleId) throw tripError('vehicleId обязателен');
  if (!findServiceVehicle(vehicleId, vehicles)) throw tripError('Служебная машина не найдена', 404);

  const status = normalizeTripText(body.status ?? previous?.status ?? 'draft') || 'draft';
  if (!VEHICLE_TRIP_STATUSES.has(status)) throw tripError('Некорректный статус путевого листа');

  const date = normalizeTripDate(body.date ?? previous?.date);
  if (!date) throw tripError('Укажите корректную дату выезда');

  const driverName = normalizeTripText(body.driverName ?? body.driver ?? previous?.driverName ?? previous?.driver);
  if (!driverName) throw tripError('Поле «Водитель» обязательно');

  const { routeFrom, routeTo, route } = buildTripRoute(body, previous || {});
  if (!route) throw tripError('Поле «Маршрут» обязательно');

  const completed = status === 'completed';
  const odometerStart = parseTripNumber(body.odometerStart ?? body.startMileage ?? previous?.odometerStart ?? previous?.startMileage, { required: completed });
  const odometerEnd = parseTripNumber(body.odometerEnd ?? body.endMileage ?? previous?.odometerEnd ?? previous?.endMileage, { required: completed });
  if (odometerStart !== null && odometerEnd !== null && odometerEnd < odometerStart) {
    throw tripError('Конечный пробег не может быть меньше начального');
  }

  const fuelStart = parseTripNumber(body.fuelStart ?? previous?.fuelStart);
  const fuelAdded = parseTripNumber(body.fuelAdded ?? previous?.fuelAdded);
  const fuelEnd = parseTripNumber(body.fuelEnd ?? previous?.fuelEnd);
  const distanceKm = odometerStart !== null && odometerEnd !== null ? odometerEnd - odometerStart : 0;
  const fuelConsumption = fuelStart !== null && fuelAdded !== null && fuelEnd !== null
    ? Math.max(0, fuelStart + fuelAdded - fuelEnd)
    : null;
  const now = nowIso();
  const sheetNumber = getTripSheetNumber(body, vehicleId, trips, previous, new Date(now));
  assertTripSheetNumberUnique(trips, sheetNumber, vehicleId, previous?.id);

  return {
    ...(previous || {}),
    id: previous?.id || generateId(idPrefix),
    vehicleId,
    sheetNumber,
    date,
    driver: driverName,
    driverId: normalizeTripText(body.driverId ?? previous?.driverId) || null,
    driverName,
    mechanicId: normalizeTripText(body.mechanicId ?? previous?.mechanicId) || null,
    serviceRequestId: normalizeTripText(body.serviceRequestId ?? body.serviceTicketId ?? previous?.serviceRequestId ?? previous?.serviceTicketId) || null,
    route,
    routeFrom,
    routeTo,
    purpose: normalizeTripText(body.purpose ?? previous?.purpose),
    startMileage: odometerStart ?? 0,
    endMileage: odometerEnd,
    distance: distanceKm,
    odometerStart,
    odometerEnd,
    distanceKm,
    fuelStart,
    fuelAdded,
    fuelEnd,
    fuelConsumption,
    status,
    startedAt: body.startedAt !== undefined ? (body.startedAt || null) : previous?.startedAt || null,
    completedAt: completed ? (body.completedAt || previous?.completedAt || now) : (body.completedAt !== undefined ? (body.completedAt || null) : previous?.completedAt || null),
    serviceTicketId: normalizeTripText(body.serviceTicketId ?? body.serviceRequestId ?? previous?.serviceTicketId ?? previous?.serviceRequestId) || null,
    clientId: normalizeTripText(body.clientId ?? previous?.clientId) || null,
    comment: normalizeTripText(body.comment ?? previous?.comment),
    createdAt: previous?.createdAt || now,
    createdBy: previous?.createdBy || userName,
    updatedAt: now,
    updatedBy: userName,
  };
}

function applyVehicleMileageFromTrip(vehicles = [], trip, nowIso = () => new Date().toISOString()) {
  const odometerEnd = Number(trip?.odometerEnd ?? trip?.endMileage);
  if (!Number.isFinite(odometerEnd)) return vehicles;
  const vIdx = vehicles.findIndex(v => v.id === trip.vehicleId);
  if (vIdx === -1 || odometerEnd < (vehicles[vIdx].currentMileage || 0)) return vehicles;
  const now = nowIso();
  const next = [...vehicles];
  next[vIdx] = {
    ...next[vIdx],
    currentMileage: odometerEnd,
    mileageUpdatedAt: now,
    updatedAt: now,
  };
  return next;
}

module.exports = {
  VEHICLE_TRIP_STATUSES,
  normalizeTripText,
  normalizeTripDate,
  parseTripNumber,
  findServiceVehicle,
  buildTripRoute,
  getTripSheetNumber,
  assertTripSheetNumberUnique,
  normalizeVehicleTripPayload,
  applyVehicleMileageFromTrip,
};
