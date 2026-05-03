import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClientQuickActions,
  buildEquipmentQuickActions,
  buildRentalQuickActions,
} from '../src/app/lib/quickActions.js';

function canFrom(map) {
  return (action, section) => Boolean(map[section]?.includes(action));
}

const adminCan = canFrom({
  clients: ['view', 'create', 'edit'],
  equipment: ['view', 'create', 'edit'],
  rentals: ['view', 'create', 'edit'],
  documents: ['view', 'create', 'edit'],
  service: ['view', 'create', 'edit'],
  payments: ['view', 'create', 'edit'],
  finance: ['view', 'create', 'edit'],
  deliveries: ['view', 'create', 'edit'],
  tasks_center: ['view'],
});

test('admin gets client quick actions for working scenarios', () => {
  const actions = buildClientQuickActions({
    client: { id: 'client-1', company: 'ООО Альфа' },
    can: adminCan,
    role: 'Администратор',
  });
  const ids = actions.map(action => action.id);

  assert.ok(ids.includes('client-create-rental'));
  assert.ok(ids.includes('client-create-document'));
  assert.ok(ids.includes('client-create-debt-plan'));
  assert.ok(ids.includes('client-documents'));
  assert.ok(ids.includes('client-payments'));
  assert.ok(ids.includes('client-tasks'));
});

test('quick actions hide finance and documents when role lacks permissions', () => {
  const can = canFrom({
    clients: ['view'],
    rentals: ['view'],
    service: ['view'],
    tasks_center: ['view'],
  });
  const clientActions = buildClientQuickActions({
    client: { id: 'client-1', company: 'ООО Альфа' },
    can,
    role: 'Менеджер без финансов',
  });
  const rentalActions = buildRentalQuickActions({
    rental: { id: 'R-1' },
    can,
    clientId: 'client-1',
    equipmentId: 'eq-1',
  });

  assert.equal(clientActions.some(action => action.id === 'client-documents'), false);
  assert.equal(clientActions.some(action => action.id === 'client-payments'), false);
  assert.equal(clientActions.some(action => action.id === 'client-create-debt-plan'), false);
  assert.equal(rentalActions.some(action => action.id === 'rental-documents'), false);
  assert.equal(rentalActions.some(action => action.id === 'rental-payments'), false);
});

test('equipment in service does not offer unsafe active rental action', () => {
  const actions = buildEquipmentQuickActions({
    equipment: { id: 'eq-1', inventoryNumber: 'INV-1', status: 'in_service' },
    can: adminCan,
  });
  const rentalAction = actions.find(action => action.id === 'equipment-create-rental');

  assert.ok(rentalAction);
  assert.equal(rentalAction.disabled, true);
  assert.match(rentalAction.reason, /сервисе/);
});

test('quick action labels and urls do not contain bad placeholders', () => {
  const actions = buildEquipmentQuickActions({
    equipment: { id: 'eq-1', inventoryNumber: NaN, status: null },
    can: adminCan,
    currentRental: { id: 'R-1' },
  });
  const text = actions.map(action => `${action.label} ${action.to || ''} ${action.reason || ''}`).join(' ');

  assert.doesNotMatch(text, /NaN|undefined|null|\[object Object\]/);
});
