import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuickActionContext,
  contextFilterLabel,
  hasClientContext,
  matchesClientContext,
  normalizeContextName,
} from '../src/app/lib/quickActionContext.js';

test('buildQuickActionContext reads safe query values', () => {
  const context = buildQuickActionContext(new URLSearchParams({
    action: 'create',
    clientId: 'client-1',
    clientName: ' ООО Альфа ',
    rentalId: 'rent-1',
    equipmentId: 'eq-1',
    equipmentInv: 'INV-1',
  }));

  assert.deepEqual(context, {
    action: 'create',
    clientId: 'client-1',
    clientName: 'ООО Альфа',
    rentalId: 'rent-1',
    equipmentId: 'eq-1',
    equipmentInv: 'INV-1',
  });
});

test('matchesClientContext prefers stable client id', () => {
  const context = { clientId: 'client-1', clientName: 'ООО Альфа' };

  assert.equal(matchesClientContext({ clientId: 'client-1', clientName: 'Другое имя' }, context), true);
  assert.equal(matchesClientContext({ clientId: 'client-2', clientName: 'ООО Альфа' }, context), false);
});

test('matchesClientContext uses only exact normalized name fallback when ids are absent', () => {
  const context = { clientName: '  ООО   Альфа ' };

  assert.equal(matchesClientContext({ clientName: 'ооо альфа' }, context), true);
  assert.equal(matchesClientContext({ clientName: 'ООО Альфа Север' }, context), false);
  assert.equal(matchesClientContext({ clientName: '' }, context), false);
});

test('client context helpers avoid bad placeholder values', () => {
  const context = buildQuickActionContext({ clientId: NaN, clientName: null });

  assert.equal(hasClientContext(context), false);
  assert.equal(contextFilterLabel({ clientName: undefined, clientId: 'client-1' }), 'client-1');
  assert.equal(normalizeContextName(' ООО   Альфа '), 'ооо альфа');
});
