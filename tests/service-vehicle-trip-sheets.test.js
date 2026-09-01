import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeVehicleTripPayload,
  applyVehicleMileageFromTrip,
  buildVehicleTripPersistenceEntries,
} = require('../server/lib/service-vehicle-trips-core.js');
const { createAccessControl } = require('../server/lib/access-control.js');

const vehicles = [{ id: 'SV-1', plateNumber: 'A001AA', currentMileage: 1000 }];
const nowIso = () => '2026-05-09T09:00:00.000Z';
let idCounter = 0;
const generateId = prefix => `${prefix}-${++idCounter}`;

function makeTrip(payload, options = {}) {
  return normalizeVehicleTripPayload(payload, {
    trips: options.trips || [],
    vehicles: options.vehicles || vehicles,
    previous: options.previous || null,
    userName: 'Офис',
    nowIso,
    generateId,
    idPrefix: 'VT',
  });
}

test('service vehicle trip sheet calculates distance and fuel consumption', () => {
  const trip = makeTrip({
    vehicleId: 'SV-1',
    sheetNumber: 'PL-1',
    date: '2026-05-09',
    driverName: 'Петров',
    routeFrom: 'Склад',
    routeTo: 'Объект',
    purpose: 'Сервисная заявка',
    odometerStart: 1200,
    odometerEnd: 1285,
    fuelStart: 40,
    fuelAdded: 20,
    fuelEnd: 35,
    status: 'completed',
  });

  assert.equal(trip.route, 'Склад — Объект');
  assert.equal(trip.distanceKm, 85);
  assert.equal(trip.distance, 85);
  assert.equal(trip.fuelConsumption, 25);
  assert.equal(trip.completedAt, '2026-05-09T09:00:00.000Z');
});

test('service vehicle trip sheet preserves a date-only value without timezone conversion', () => {
  const trip = makeTrip({
    vehicleId: 'SV-1',
    sheetNumber: 'PL-DATE',
    date: '2026-08-02',
    driverName: 'Петров',
    route: 'Склад — Объект',
  });

  assert.equal(trip.date, '2026-08-02');
  assert.throws(() => makeTrip({
    vehicleId: 'SV-1',
    sheetNumber: 'PL-BAD-DATE',
    date: '2026-02-30',
    driverName: 'Петров',
    route: 'Склад — Объект',
  }), /корректную дату/);
});

test('service vehicle trip sheet validates vehicle, status, odometer and completed mileage', () => {
  assert.throws(() => makeTrip({
    vehicleId: 'missing',
    date: '2026-05-09',
    driverName: 'Петров',
    route: 'Склад — Объект',
  }), /Служебная машина не найдена/);

  assert.throws(() => makeTrip({
    vehicleId: 'SV-1',
    date: '2026-05-09',
    driverName: 'Петров',
    route: 'Склад — Объект',
    status: 'bad',
  }), /Некорректный статус/);

  assert.throws(() => makeTrip({
    vehicleId: 'SV-1',
    date: '2026-05-09',
    driverName: 'Петров',
    route: 'Склад — Объект',
    odometerStart: 200,
    odometerEnd: 100,
  }), /Конечный пробег/);

  assert.throws(() => makeTrip({
    vehicleId: 'SV-1',
    date: '2026-05-09',
    driverName: 'Петров',
    route: 'Склад — Объект',
    status: 'completed',
  }), /Заполните пробег/);
});

test('service vehicle trip sheets are unique by sheet number inside one vehicle only', () => {
  const existing = makeTrip({
    vehicleId: 'SV-1',
    sheetNumber: 'PL-1',
    date: '2026-05-09',
    driverName: 'Петров',
    route: 'Склад — Объект',
  });

  assert.throws(() => makeTrip({
    vehicleId: 'SV-1',
    sheetNumber: 'PL-1',
    date: '2026-05-10',
    driverName: 'Сидоров',
    route: 'Склад — Сервис',
  }, { trips: [existing] }), /уже используется/);

  const otherVehicleTrip = makeTrip({
    vehicleId: 'SV-2',
    sheetNumber: 'PL-1',
    date: '2026-05-10',
    driverName: 'Сидоров',
    route: 'Склад — Сервис',
  }, {
    trips: [existing],
    vehicles: [...vehicles, { id: 'SV-2', plateNumber: 'B002BB' }],
  });

  assert.equal(otherVehicleTrip.sheetNumber, 'PL-1');
});

test('vehicle assignment is immutable on trip edit so mileage provenance cannot drift', () => {
  const previous = makeTrip({
    vehicleId: 'SV-1',
    date: '2026-05-09',
    driverName: 'Петров',
    route: 'Склад — Объект',
  });
  assert.throws(() => makeTrip({ vehicleId: 'SV-2' }, {
    previous,
    trips: [previous],
    vehicles: [...vehicles, { id: 'SV-2', plateNumber: 'B002BB', currentMileage: 0 }],
  }), error => error?.status === 409 && /другую машину/.test(error.message));
});

test('service vehicle trip sheet updates vehicle mileage from latest odometer end', () => {
  const trip = makeTrip({
    vehicleId: 'SV-1',
    sheetNumber: 'PL-2',
    date: '2026-05-09',
    driverName: 'Петров',
    route: 'Склад — Объект',
    odometerStart: 1200,
    odometerEnd: 1285,
  });

  const nextVehicles = applyVehicleMileageFromTrip(vehicles, trip, nowIso);
  assert.equal(nextVehicles[0].currentMileage, 1285);
  assert.equal(nextVehicles[0].mileageUpdatedAt, '2026-05-09T09:00:00.000Z');
});

test('all trip create/update aliases stage trip and mileage projection as one atomic batch', () => {
  const trip = makeTrip({
    vehicleId: 'SV-1',
    date: '2026-05-09',
    driverName: 'Петров',
    route: 'Склад — Объект',
    odometerStart: 1200,
    odometerEnd: 1285,
  });
  const aliases = [
    'POST /vehicle-trips',
    'PUT /vehicle-trips/:id',
    'POST /service-vehicles/:vehicleId/trip-sheets',
    'PATCH /service-vehicles/:vehicleId/trip-sheets/:id',
  ];

  for (const alias of aliases) {
    const state = {
      vehicle_trips: [],
      service_vehicles: structuredClone(vehicles),
    };
    const before = structuredClone(state);
    const entries = buildVehicleTripPersistenceEntries({
      trips: [trip],
      vehicles: state.service_vehicles,
      trip,
      nowIso,
    });
    assert.deepEqual(entries.map(entry => entry.name), ['vehicle_trips', 'service_vehicles'], alias);

    const injected = new Error(`injected failure: ${alias}`);
    assert.throws(() => {
      const staged = structuredClone(state);
      for (const entry of entries) staged[entry.name] = structuredClone(entry.value);
      throw injected;
    }, error => error === injected);
    assert.deepEqual(state, before, alias);

    const staged = structuredClone(state);
    for (const entry of entries) staged[entry.name] = structuredClone(entry.value);
    Object.assign(state, staged);
    assert.equal(state.vehicle_trips.length, 1, alias);
    assert.equal(state.service_vehicles[0].currentMileage, 1285, alias);
  }
});

test('server routes use the atomic trip-and-mileage batch for every write alias', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../server/server.js', import.meta.url), 'utf8');
  const routeBlock = source.slice(
    source.indexOf("apiRouter.post('/vehicle-trips'"),
    source.indexOf("apiRouter.delete('/service-vehicles/:vehicleId/trip-sheets/:id'"),
  );
  assert.equal((routeBlock.match(/persistVehicleTripAndMileage\(/g) || []).length, 4);
  assert.doesNotMatch(routeBlock, /writeData\('vehicle_trips'/);
  assert.doesNotMatch(routeBlock, /assignNewRecord\('vehicle_trips'/);
});

test('service vehicle trip sheet access keeps manager read-only and denies investor mutation', () => {
  const state = {
    service_vehicles: vehicles,
    vehicle_trips: [{ id: 'VT-1', vehicleId: 'SV-1', driver: 'Петров', route: 'Склад — Объект' }],
  };
  const access = createAccessControl({ readData: name => state[name] || [] });
  const office = { userId: 'U-office', userName: 'Офис', userRole: 'Офис-менеджер' };
  const mechanic = { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' };
  const manager = { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' };
  const investor = { userId: 'U-investor', userName: 'Инвестор', userRole: 'Инвестор' };

  assert.equal(access.canMutateEntity('vehicle_trips', state.vehicle_trips[0], office), true);
  assert.equal(access.canMutateEntity('vehicle_trips', state.vehicle_trips[0], mechanic), true);
  assert.equal(access.canMutateEntity('vehicle_trips', state.vehicle_trips[0], manager), false);
  assert.equal(access.canMutateEntity('vehicle_trips', state.vehicle_trips[0], investor), false);
});
