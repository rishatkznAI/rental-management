import test from 'node:test';
import assert from 'node:assert/strict';

import {
  forgetIdempotentAttempt,
  idempotencyKeyForAttempt,
  isUnknownMutationOutcome,
} from '../src/app/lib/rental-create-attempt.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
    values,
  };
}

test('same logical rental payload keeps one idempotency key across retries and remounts', () => {
  const storage = memoryStorage();
  const firstAttempts = new Map();
  const firstPayload = {
    clientId: 'C-1',
    equipmentId: 'EQ-1',
    startDate: '2026-08-10',
    plannedReturnDate: '2026-08-12',
    comments: 'unknown outcome',
  };
  const first = idempotencyKeyForAttempt('rental-create', firstPayload, firstAttempts, {
    persist: true,
    storage,
  });
  const immediateRetry = idempotencyKeyForAttempt('rental-create', { ...firstPayload }, firstAttempts, {
    persist: true,
    storage,
  });
  const remountedRetry = idempotencyKeyForAttempt('rental-create', {
    comments: 'unknown outcome',
    plannedReturnDate: '2026-08-12',
    startDate: '2026-08-10',
    equipmentId: 'EQ-1',
    clientId: 'C-1',
  }, new Map(), {
    persist: true,
    storage,
  });

  assert.equal(immediateRetry.key, first.key);
  assert.equal(remountedRetry.key, first.key);
  assert.equal(storage.values.size, 1);

  forgetIdempotentAttempt(remountedRetry, new Map([[remountedRetry.fingerprint, remountedRetry]]), {
    persist: true,
    storage,
  });
  assert.equal(storage.values.size, 0);
});

test('payload correction or context change creates a new logical rental attempt', () => {
  const storage = memoryStorage();
  const attempts = new Map();
  const base = {
    clientId: 'C-1',
    objectId: 'CO-1',
    contractId: 'CC-1',
    equipmentId: 'EQ-1',
    startDate: '2026-08-10',
    plannedReturnDate: '2026-08-12',
    price: 3000,
    creditRiskAcknowledged: false,
  };
  const original = idempotencyKeyForAttempt('rental-create', base, attempts, { persist: true, storage });
  const changedClient = idempotencyKeyForAttempt('rental-create', {
    ...base,
    clientId: 'C-2',
    objectId: 'CO-2',
    contractId: 'CC-2',
  }, attempts, { persist: true, storage });
  const changedEquipmentDates = idempotencyKeyForAttempt('rental-create', {
    ...base,
    equipmentId: 'EQ-2',
    startDate: '2026-08-13',
    plannedReturnDate: '2026-08-15',
  }, attempts, { persist: true, storage });
  const acknowledged = idempotencyKeyForAttempt('rental-create', {
    ...base,
    creditRiskAcknowledged: true,
  }, attempts, { persist: true, storage });

  assert.notEqual(changedClient.key, original.key);
  assert.notEqual(changedEquipmentDates.key, original.key);
  assert.notEqual(acknowledged.key, original.key);
  assert.equal(storage.values.size, 4);
});

test('network and gateway failures are unknown outcomes while application rejections are confirmed', () => {
  assert.equal(isUnknownMutationOutcome(new TypeError('Failed to fetch')), true);
  assert.equal(isUnknownMutationOutcome({ status: 504 }), true);
  assert.equal(isUnknownMutationOutcome({ status: 409 }), false);
  assert.equal(isUnknownMutationOutcome({ status: 500 }), false);
});
