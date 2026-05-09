import test from 'node:test';
import assert from 'node:assert/strict';
import { isSaleModeEquipment, saleStatusLabel } from '../src/app/lib/equipmentSaleMode.js';
import { buildEquipmentQuickActions } from '../src/app/lib/quickActions.js';

const allowAll = () => true;

test('sale mode turns on from sales route context and explicit sale fields', () => {
  assert.equal(isSaleModeEquipment({ id: 'EQ-1', status: 'available' }, { salesContext: true }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-2', isForSale: true }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-3', saleStatus: 'reserved' }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-4', saleStatus: 'На продаже' }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-5', salesStatus: 'on_sale' }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-6', status: 'На продаже' }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-7', tags: ['склад', 'продажа'] }), true);
  assert.equal(isSaleModeEquipment({ id: 'EQ-8', status: 'available', category: 'own' }), false);
});

test('sale quick actions hide rental and fleet service actions', () => {
  const actions = buildEquipmentQuickActions({
    equipment: { id: 'EQ-sale', inventoryNumber: 'INV-sale', status: 'available', saleMode: true },
    can: allowAll,
  });
  const ids = actions.map(action => action.id);
  const labels = actions.map(action => action.label);

  assert.ok(ids.includes('equipment-sale-pdi'));
  assert.ok(ids.includes('equipment-sale-documents'));
  assert.ok(ids.includes('equipment-sale-photo'));
  assert.ok(ids.includes('equipment-sale-deal'));
  assert.ok(ids.includes('equipment-sale-reserve'));
  assert.ok(ids.includes('equipment-sale-remove'));
  assert.ok(ids.includes('equipment-sale-sold'));

  assert.ok(!labels.includes('Создать аренду'));
  assert.ok(!labels.includes('История аренд'));
  assert.ok(!labels.includes('Очередь сервиса'));
  assert.ok(!labels.includes('Создать сервисную заявку'));
});

test('normal equipment keeps rental quick actions', () => {
  const actions = buildEquipmentQuickActions({
    equipment: { id: 'EQ-rent', inventoryNumber: 'INV-rent', status: 'available' },
    can: allowAll,
  });
  const labels = actions.map(action => action.label);

  assert.ok(labels.includes('Создать аренду'));
  assert.ok(labels.includes('История аренд'));
  assert.ok(labels.includes('Очередь сервиса'));
  assert.ok(labels.includes('Создать сервисную заявку'));
});

test('sale status label uses existing sale and sold fields', () => {
  assert.equal(saleStatusLabel({ isForSale: true }), 'На продаже');
  assert.equal(saleStatusLabel({ saleStatus: 'В сделке' }), 'В сделке');
  assert.equal(saleStatusLabel({ category: 'sold', saleStatus: 'ignored' }), 'Продана');
});
