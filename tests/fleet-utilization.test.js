import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateCurrentFleetUtilization,
  calculateMonthlyFleetUtilization,
  isActiveRentalFleetEquipment,
} from '../src/app/lib/fleetUtilization.js';

function equipment(overrides = {}) {
  return {
    id: overrides.id || 'eq-1',
    inventoryNumber: overrides.inventoryNumber || overrides.id || 'INV-1',
    serialNumber: overrides.serialNumber || `SN-${overrides.id || '1'}`,
    category: overrides.category || 'own',
    activeInFleet: overrides.activeInFleet ?? true,
    status: overrides.status || 'available',
    ...overrides,
  };
}

test('active rental fleet denominator includes only active own and partner fleet', () => {
  assert.equal(isActiveRentalFleetEquipment(equipment({ category: 'own', activeInFleet: true })), true);
  assert.equal(isActiveRentalFleetEquipment(equipment({ category: 'partner', activeInFleet: true })), true);
  assert.equal(isActiveRentalFleetEquipment(equipment({ category: 'sold', activeInFleet: true })), false);
  assert.equal(isActiveRentalFleetEquipment(equipment({ category: 'client', activeInFleet: true })), false);
  assert.equal(isActiveRentalFleetEquipment(equipment({ category: 'own', activeInFleet: false })), false);
});

test('inactive-like statuses are excluded but in-service rental fleet stays in denominator', () => {
  assert.equal(isActiveRentalFleetEquipment(equipment({ status: 'inactive' })), false);
  assert.equal(isActiveRentalFleetEquipment(equipment({ status: 'sold' })), false);
  assert.equal(isActiveRentalFleetEquipment(equipment({ status: 'written_off' })), false);
  assert.equal(isActiveRentalFleetEquipment(equipment({ status: 'archived' })), false);
  assert.equal(isActiveRentalFleetEquipment(equipment({ status: 'in_service', activeInFleet: true })), true);
});

test('current utilization uses active rental records for numerator, not equipment status', () => {
  const fleet = [
    equipment({ id: 'own-active', inventoryNumber: '100', status: 'available' }),
    equipment({ id: 'partner-service', inventoryNumber: '200', category: 'partner', status: 'in_service' }),
    equipment({ id: 'status-rented-only', inventoryNumber: '300', status: 'rented' }),
    equipment({ id: 'sold-unit', inventoryNumber: '400', category: 'sold', status: 'rented' }),
    equipment({ id: 'client-unit', inventoryNumber: '500', category: 'client' }),
    equipment({ id: 'inactive-unit', inventoryNumber: '600', status: 'inactive' }),
  ];

  const result = calculateCurrentFleetUtilization(fleet, [
    { id: 'r-1', equipmentId: 'own-active', equipmentInv: '100', status: 'active' },
  ]);

  assert.equal(result.activeEquipment, 3);
  assert.equal(result.rentedEquipment, 1);
  assert.equal(result.utilization, 33);
});

test('active rental can match by unique inventory number when equipmentId is missing', () => {
  const result = calculateCurrentFleetUtilization(
    [equipment({ id: 'eq-100', inventoryNumber: 'INV-100', status: 'available' })],
    [{ id: 'r-1', equipmentInv: 'INV-100', status: 'active' }],
  );

  assert.equal(result.activeEquipment, 1);
  assert.equal(result.rentedEquipment, 1);
  assert.equal(result.utilization, 100);
});

test('monthly utilization denominator is active rental fleet, not all equipment length', () => {
  const fleet = [
    equipment({ id: 'active-1', inventoryNumber: 'A-1' }),
    equipment({ id: 'active-2', inventoryNumber: 'A-2', status: 'in_service' }),
    ...Array.from({ length: 8 }, (_, index) => equipment({
      id: `inactive-${index}`,
      inventoryNumber: `I-${index}`,
      status: 'inactive',
    })),
  ];

  const result = calculateMonthlyFleetUtilization(
    fleet,
    [{ id: 'r-1', equipmentId: 'active-1', status: 'closed', startDate: '2026-04-01', endDate: '2026-04-30' }],
    new Date(2026, 3, 1),
    new Date(2026, 3, 30),
  );

  assert.equal(result.activeEquipment, 2);
  assert.equal(result.totalPossible, 60);
  assert.equal(result.occupiedDays, 30);
  assert.equal(result.utilization, 50);
});

test('zero denominator utilization is finite zero', () => {
  const current = calculateCurrentFleetUtilization(
    [equipment({ id: 'sold', category: 'sold' })],
    [{ id: 'r-1', equipmentId: 'sold', status: 'active' }],
  );
  const monthly = calculateMonthlyFleetUtilization(
    [equipment({ id: 'sold', category: 'sold' })],
    [{ id: 'r-1', equipmentId: 'sold', status: 'active', startDate: '2026-04-01', endDate: '2026-04-30' }],
    new Date(2026, 3, 1),
    new Date(2026, 3, 30),
  );

  assert.equal(current.activeEquipment, 0);
  assert.equal(current.rentedEquipment, 0);
  assert.equal(current.utilization, 0);
  assert.equal(Number.isFinite(current.utilization), true);
  assert.equal(monthly.totalPossible, 0);
  assert.equal(monthly.utilization, 0);
  assert.equal(Number.isFinite(monthly.utilization), true);
});

test('Dashboard and Reports use shared fleet utilization formula', () => {
  const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'), 'utf-8');
  const reportsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Reports.tsx'), 'utf-8');

  assert.match(dashboardSource, /calculateCurrentFleetUtilization/);
  assert.match(reportsSource, /calculateCurrentFleetUtilization/);
  assert.match(reportsSource, /calculateMonthlyFleetUtilization/);
  assert.doesNotMatch(reportsSource, /equipment\.filter\(e => e\.status === 'rented'\)/);
  assert.doesNotMatch(reportsSource, /totalPossible = totalEquipment \* daysInMonth/);
});
