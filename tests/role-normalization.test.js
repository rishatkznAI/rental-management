import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createAccessControl } = require('../server/lib/access-control.js');
const { normalizeRole } = require('../server/lib/role-groups.js');

test('normalizeRole maps production role aliases to canonical Russian roles', () => {
  assert.equal(normalizeRole('admin'), 'Администратор');
  assert.equal(normalizeRole('administrator'), 'Администратор');
  assert.equal(normalizeRole('администратор'), 'Администратор');
  assert.equal(normalizeRole('менеджер по аренде'), 'Менеджер по аренде');
  assert.equal(normalizeRole('office manager'), 'Офис-менеджер');
  assert.equal(normalizeRole('rental_manager'), 'Менеджер по аренде');
  assert.equal(normalizeRole('sales manager'), 'Менеджер по продажам');
  assert.equal(normalizeRole('mechanic'), 'Механик');
  assert.equal(normalizeRole('carrier'), 'Перевозчик');
  assert.equal(normalizeRole('investor'), 'Инвестор');
});

test('access-control grants data access for normalized production aliases', () => {
  const state = {
    equipment: [{ id: 'EQ-1' }],
    rentals: [{ id: 'R-1', managerId: 'U-manager' }],
    gantt_rentals: [{ id: 'GR-1', managerId: 'U-manager' }],
    clients: [{ id: 'C-1', managerId: 'U-manager' }],
    service: [{ id: 'S-1', assignedMechanicId: 'M-1' }],
    mechanics: [{ id: 'M-1', userId: 'U-mechanic', status: 'active' }],
  };
  const access = createAccessControl({ readData: name => state[name] || [] });

  assert.deepEqual(
    access.filterCollectionByScope('equipment', state.equipment, { userId: 'U-admin', userRole: 'admin' }).map(item => item.id),
    ['EQ-1'],
  );
  assert.deepEqual(
    access.filterCollectionByScope('rentals', state.rentals, { userId: 'U-manager', userRole: 'rental manager' }).map(item => item.id),
    ['R-1'],
  );
  assert.deepEqual(
    access.filterCollectionByScope('service', state.service, { userId: 'U-mechanic', userName: 'Tech', userRole: 'mechanic' }).map(item => item.id),
    ['S-1'],
  );
});

test('frontend normalizeUserRole keeps aliases aligned with backend', () => {
  const sourcePath = fileURLToPath(new URL('../src/app/lib/userStorage.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  for (const alias of ['admin', 'office_manager', 'rental_manager', 'sales_manager', 'mechanic', 'carrier', 'investor']) {
    assert.match(source, new RegExp(`\\['${alias}'`));
  }
});

test('carrier aliases are normalized before bot-only frontend checks', () => {
  assert.equal(normalizeRole('delivery carrier'), 'Перевозчик');
  assert.equal(normalizeRole('delivery_carrier'), 'Перевозчик');
});
