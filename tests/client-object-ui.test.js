import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildClientObjectRentalAggregates } from '../src/app/lib/clientObjectAggregates.js';

const clientDetailSource = fs.readFileSync(new URL('../src/app/pages/ClientDetail.tsx', import.meta.url), 'utf8');
const deliveriesSource = fs.readFileSync(new URL('../src/app/pages/Deliveries.tsx', import.meta.url), 'utf8');

test('Client detail uses the explicit ClientObject empty state and complete create/edit fields', () => {
  assert.match(clientDetailSource, /Объекты пока не добавлены/);
  assert.match(clientDetailSource, /Добавьте площадку, куда клиенту доставляется техника/);
  assert.match(clientDetailSource, /open=\{objectDialogOpen\}/);
  assert.match(clientDetailSource, /Например, ЖК Южный парк/);
  assert.match(clientDetailSource, /Казань, ул\. \.\.\./);
  assert.match(clientDetailSource, /Иван Петров/);
  assert.match(clientDetailSource, /КПП №2, въезд со стороны\.\.\./);
  assert.match(clientDetailSource, /comment: editObjectForm\.comment\.trim\(\)/);
  assert.doesNotMatch(clientDetailSource, /Объекты клиента пока не заведены/);
});

test('ClientObject aggregates use stable ids, exclude terminal and foreign rentals, and deduplicate projections', () => {
  const result = buildClientObjectRentalAggregates([
    { id: 'GR-1', rentalId: 'R-1', clientId: 'C-1', objectId: 'CO-1', equipmentId: 'EQ-1', equipmentInv: 'INV-1', status: 'active' },
    { id: 'GR-1-copy', rentalId: 'R-1', clientId: 'C-1', objectId: 'CO-1', equipmentId: 'EQ-1', status: 'active' },
    { id: 'GR-2', rentalId: 'R-2', clientId: 'C-1', objectId: 'CO-1', equipmentId: 'EQ-2', status: 'created' },
    { id: 'GR-3', rentalId: 'R-3', clientId: 'C-1', objectId: 'CO-1', equipmentId: 'EQ-3', status: 'returned' },
    { id: 'GR-4', rentalId: 'R-4', clientId: 'C-2', objectId: 'CO-1', equipmentId: 'EQ-4', status: 'active' },
    { id: 'GR-5', rentalId: 'R-5', clientId: 'C-1', equipmentId: 'EQ-5', status: 'active' },
  ], { clientId: 'C-1' });

  assert.deepEqual(result, {
    'CO-1': { activeRentals: 2, equipmentCount: 2 },
  });
});

test('delivery form prefills editable destination and contact fields from the rental ClientObject', () => {
  assert.match(deliveriesSource, /useClientObjectsList\(\{ enabled: canManageDeliveries \}\)/);
  assert.match(deliveriesSource, /shippingTo: objectAddress \|\| classic\?\.deliveryAddress/);
  assert.match(deliveriesSource, /contactName: clientObject\?\.contactName \|\| client\?\.contact/);
  assert.match(deliveriesSource, /contactPhone: clientObject\?\.contactPhone \|\| client\?\.phone/);
});
