import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRentalNewRoute,
  parseRentalNewRoute,
  stripRentalNewOuterQuery,
} from '../src/app/lib/rental-new-route.js';

test('canonical rental-new builder emits only stable primary IDs in a fixed order', () => {
  assert.equal(buildRentalNewRoute(), '/rentals/new');
  assert.equal(
    buildRentalNewRoute({ equipmentId: 'EQ 2', clientId: 'CLIENT/1' }),
    '/rentals/new?clientId=CLIENT%2F1&equipmentId=EQ+2',
  );
});

test('parser accepts legacy outer query when canonical hash query is absent', () => {
  const parsed = parseRentalNewRoute({
    routerSearch: '',
    browserSearch: '?clientId=CLIENT-A&equipmentId=EQ-A',
  });

  assert.deepEqual(parsed.client, { kind: 'id', value: 'CLIENT-A', source: 'outer-legacy' });
  assert.deepEqual(parsed.equipment, { kind: 'id', value: 'EQ-A', source: 'outer-legacy' });
  assert.equal(parsed.hasOuterRentalParams, true);
});

test('canonical hash query wins conflicting outer query values', () => {
  const parsed = parseRentalNewRoute({
    routerSearch: '?clientId=CLIENT-B&equipmentId=EQ-B',
    browserSearch: '?clientId=CLIENT-A&equipmentId=EQ-A',
  });

  assert.deepEqual(parsed.client, { kind: 'id', value: 'CLIENT-B', source: 'canonical' });
  assert.deepEqual(parsed.equipment, { kind: 'id', value: 'EQ-B', source: 'canonical' });
});

test('legacy name and inventory aliases are parsed only as compatibility inputs', () => {
  const parsed = parseRentalNewRoute({
    routerSearch: '?clientName=ООО+Альфа&equipmentInv=INV-7',
  });

  assert.deepEqual(parsed.client, { kind: 'client-name', value: 'ООО Альфа', source: 'canonical-legacy' });
  assert.deepEqual(parsed.equipment, { kind: 'equipment-inventory', value: 'INV-7', source: 'canonical-legacy' });
  assert.equal(parsed.hasLegacyHashParams, true);
});

test('outer query cleanup preserves unrelated browser parameters', () => {
  assert.equal(
    stripRentalNewOuterQuery('?_smoke=1&clientId=CLIENT-A&equipmentInv=INV-7&theme=dark'),
    '?_smoke=1&theme=dark',
  );
});
