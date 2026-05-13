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
  assert.equal(normalizeRole('Руководитель'), 'Руководитель');
  assert.equal(normalizeRole('руководитель'), 'Руководитель');
  assert.equal(normalizeRole('rukovoditel'), 'Руководитель');
  assert.equal(normalizeRole('head'), 'Руководитель');
  assert.equal(normalizeRole('manager_head'), 'Руководитель');
  assert.equal(normalizeRole('supervisor'), 'Руководитель');
  assert.equal(normalizeRole('director_viewer'), 'Руководитель');
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

test('head role can read movement collections without commercial rental fields', () => {
  const state = {
    equipment: [{ id: 'EQ-1', model: 'Lift' }],
    rentals: [{
      id: 'R-1',
      equipmentId: 'EQ-1',
      client: 'Client',
      amount: 100000,
      paidAmount: 1000,
      paymentStatus: 'partial',
      margin: 9000,
    }],
    gantt_rentals: [{
      id: 'GR-1',
      rentalId: 'R-1',
      equipmentId: 'EQ-1',
      price: 100000,
      rate: '1000',
      totalAmount: 100000,
    }],
    shipping_photos: [{ id: 'SP-1', rentalId: 'R-1', equipmentId: 'EQ-1', type: 'shipping' }],
  };
  const access = createAccessControl({ readData: name => state[name] || [] });
  const head = { userId: 'U-head', userRole: 'head' };

  assert.deepEqual(
    access.filterCollectionByScope('equipment', state.equipment, head).map(item => item.id),
    ['EQ-1'],
  );
  assert.deepEqual(
    access.filterCollectionByScope('rentals', state.rentals, head).map(item => item.id),
    ['R-1'],
  );
  assert.deepEqual(
    access.filterCollectionByScope('gantt_rentals', state.gantt_rentals, head).map(item => item.id),
    ['GR-1'],
  );
  assert.deepEqual(
    access.filterCollectionByScope('shipping_photos', state.shipping_photos, head).map(item => item.id),
    ['SP-1'],
  );

  const [rental] = access.sanitizeCollectionForRead('rentals', state.rentals, head);
  assert.equal(rental.client, 'Client');
  assert.equal('amount' in rental, false);
  assert.equal('paidAmount' in rental, false);
  assert.equal('paymentStatus' in rental, false);
  assert.equal('margin' in rental, false);
});

test('frontend normalizeUserRole keeps aliases aligned with backend', () => {
  const sourcePath = fileURLToPath(new URL('../src/app/lib/userStorage.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  for (const alias of ['admin', 'office_manager', 'rental_manager', 'sales_manager', 'mechanic', 'carrier', 'investor', 'head', 'manager_head', 'supervisor', 'director_viewer']) {
    assert.match(source, new RegExp(`\\['${alias}'`));
  }
});

test('carrier aliases are normalized before bot-only frontend checks', () => {
  assert.equal(normalizeRole('delivery carrier'), 'Перевозчик');
  assert.equal(normalizeRole('delivery_carrier'), 'Перевозчик');
});
