import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEquipmentMovementEvents,
} from '../src/app/lib/equipmentMovementEvents.js';

const equipment = {
  id: 'EQ-1',
  inventoryNumber: 'INV-1',
  serialNumber: 'SN-1',
  manufacturer: 'Mantall',
  model: 'XE',
};

test('helper collects shipping and receiving events by equipmentId', () => {
  const events = buildEquipmentMovementEvents({
    equipment,
    equipmentList: [equipment],
    shippingPhotos: [
      { id: 'SP-1', equipmentId: 'EQ-1', type: 'shipping', date: '2026-01-01', photos: ['/uploads/ship.jpg'] },
      { id: 'SP-2', equipmentId: 'EQ-1', type: 'receiving', date: '2026-01-10', photos: ['/uploads/receive.jpg'] },
    ],
  });

  assert.deepEqual(events.map(event => event.kind), ['receiving', 'shipping']);
  assert.equal(events[0].photos[0].fullUrl, '/uploads/receive.jpg');
  assert.equal(events[1].photos[0].fullUrl, '/uploads/ship.jpg');
});

test('helper collects delivery event through rentalId and merges matching shipping photos', () => {
  const events = buildEquipmentMovementEvents({
    equipment,
    equipmentList: [equipment],
    rentals: [{ id: 'R-1', equipmentId: 'EQ-1', client: 'ООО Клиент', objectName: 'Башня' }],
    deliveries: [{
      id: 'DL-1',
      type: 'shipping',
      status: 'completed',
      transportDate: '2026-02-01',
      rentalId: 'R-1',
      client: 'ООО Клиент',
      origin: 'Склад',
      destination: 'Объект',
      photos: ['/uploads/delivery.jpg'],
    }],
    shippingPhotos: [{
      id: 'SP-1',
      deliveryId: 'DL-1',
      type: 'shipping',
      date: '2026-02-01',
      photos: [{ file: { url: '/uploads/report.jpg' } }],
    }],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].deliveryId, 'DL-1');
  assert.equal(events[0].rentalId, 'R-1');
  assert.equal(events[0].source, 'mixed');
  assert.deepEqual(events[0].photos.map(photo => photo.fullUrl), ['/uploads/delivery.jpg', '/uploads/report.jpg']);
});

test('helper uses ganttRentalId and legacy inventory fallback without duplicating one delivery', () => {
  const events = buildEquipmentMovementEvents({
    equipment,
    equipmentList: [equipment],
    rentals: [{ id: 'GR-1', equipmentInv: 'INV-1', client: 'ООО Гантт' }],
    deliveries: [{
      id: 'DL-2',
      type: 'receiving',
      status: 'accepted',
      transportDate: '2026-03-03',
      ganttRentalId: 'GR-1',
      receivingPhotos: ['/uploads/return.jpg'],
    }],
    shippingPhotos: [{
      id: 'SP-2',
      deliveryId: 'DL-2',
      type: 'receiving',
      date: '2026-03-03',
      photos: ['/uploads/return.jpg'],
    }],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'receiving');
  assert.equal(events[0].ganttRentalId, 'GR-1');
  assert.equal(events[0].photos.length, 1);
});

test('helper keeps legacy photo fields safe and reports broken object photos', () => {
  const events = buildEquipmentMovementEvents({
    equipment,
    equipmentList: [equipment],
    shippingPhotos: [{
      id: 'SP-legacy',
      serialNumber: 'SN-1',
      type: 'dispatch',
      date: '2026-04-04',
      photos: [
        { attachment: { url: '/uploads/legacy.jpg' } },
        { url: '[object Object]' },
        '/undefined',
      ],
    }],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'shipping');
  assert.equal(events[0].photos[0].fullUrl, '/uploads/legacy.jpg');
  assert.equal(events[0].photos[1].fullUrl, null);
  assert.equal(events[0].photos[2].fullUrl, null);
});

test('equipment card uses full shipping photo collection and authenticated image rendering', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync('src/app/pages/EquipmentDetail.tsx', 'utf8');

  assert.match(source, /queryFn: equipmentService\.getAllShippingPhotos/);
  assert.match(source, /buildEquipmentMovementEvents/);
  assert.match(source, /Фото ещё не загружены/);
  assert.match(source, /<AuthenticatedImage/);
  assert.doesNotMatch(source, /src=\{photo\.thumbnailUrl \|\| photo\.fullUrl \|\| undefined\}/);
});
