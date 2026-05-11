import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterDeliveriesForView,
  getDeliveryEmptyState,
  getDeliveryErrorMessage,
  normalizeDeliveriesResponse,
} from '../src/app/lib/deliveries-view.js';

test('delivery view handles empty arrays and returns a real empty-state', () => {
  const deliveries = normalizeDeliveriesResponse([]);
  const filtered = filterDeliveriesForView(deliveries, { activeTab: 'all', periodFilter: 'all' }, '2026-05-11');
  const empty = getDeliveryEmptyState({ totalCount: deliveries.length, isCarrierView: false });

  assert.deepEqual(filtered, []);
  assert.equal(empty.title, 'Доставок пока нет');
  assert.match(empty.description, /создать из аренды или вручную/i);
});

test('delivery view normalizes API wrapper shapes and renders all deliveries by default', () => {
  const deliveries = normalizeDeliveriesResponse({
    deliveries: [{
      id: 'DL-1',
      status: 'completed',
      type: 'shipping',
      transportDate: '2026-04-28',
      client: 'ООО Клиент',
      cargo: 'Подъемник',
      origin: 'Склад',
      destination: 'Объект',
    }],
  });
  const filtered = filterDeliveriesForView(deliveries, { activeTab: 'all', periodFilter: 'all' }, '2026-05-11');

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'DL-1');
});

test('delivery all filter does not hide valid old completed deliveries', () => {
  const deliveries = normalizeDeliveriesResponse([
    { id: 'DL-old', status: 'completed', type: 'shipping', transportDate: '2026-04-01', client: 'Клиент' },
    { id: 'DL-active', status: 'sent', type: 'receiving', transportDate: '2026-05-11', client: 'Клиент' },
  ]);
  const filtered = filterDeliveriesForView(deliveries, { activeTab: 'all', periodFilter: 'all' }, '2026-05-11');

  assert.deepEqual(filtered.map(item => item.id), ['DL-old', 'DL-active']);
});

test('carrier active tab hides completed and cancelled deliveries', () => {
  const deliveries = normalizeDeliveriesResponse([
    { id: 'DL-sent', status: 'sent', carrierId: 'carrier-1' },
    { id: 'DL-done', status: 'completed', carrierId: 'carrier-1' },
    { id: 'DL-cancelled', status: 'cancelled', carrierId: 'carrier-1' },
  ]);
  const filtered = filterDeliveriesForView(deliveries, { activeTab: 'active', periodFilter: 'all' }, '2026-05-11');

  assert.deepEqual(filtered.map(item => item.id), ['DL-sent']);
});

test('legacy delivery fields are normalized for stable rendering', () => {
  const [delivery] = normalizeDeliveriesResponse({
    data: {
      items: [{
        deliveryNumber: 'LEG-1',
        operationType: 'Приёмка',
        status: 'В пути',
        date: '2026-05-10T12:00:00.000Z',
        deadline: '2026-05-12',
        fromAddress: 'Объект',
        toAddress: 'Склад',
        clientName: 'Legacy Client',
        equipmentName: 'LGMG AS1413',
        inventoryNumber: 'INV-1',
        driverName: 'Водитель',
        deliveryCost: '12000',
      }],
    },
  });

  assert.equal(delivery.id, 'LEG-1');
  assert.equal(delivery.type, 'receiving');
  assert.equal(delivery.status, 'in_transit');
  assert.equal(delivery.transportDate, '2026-05-10');
  assert.equal(delivery.neededBy, '2026-05-12');
  assert.equal(delivery.origin, 'Объект');
  assert.equal(delivery.destination, 'Склад');
  assert.equal(delivery.client, 'Legacy Client');
  assert.equal(delivery.cargo, 'LGMG AS1413');
  assert.equal(delivery.equipmentInv, 'INV-1');
  assert.equal(delivery.carrierName, 'Водитель');
  assert.equal(delivery.cost, 12000);
});

test('delivery API errors are exposed as error-state text', () => {
  assert.equal(getDeliveryErrorMessage(new Error('HTTP 500')), 'HTTP 500');
  assert.equal(getDeliveryErrorMessage(null), 'Не удалось загрузить доставки.');
});
