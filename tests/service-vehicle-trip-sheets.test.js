import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeVehicleTripPayload,
  applyVehicleMileageFromTrip,
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
