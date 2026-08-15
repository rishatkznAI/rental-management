import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const { backfillPaymentAllocations } = serverRequire('./lib/finance-core');

function counterparty(id, roles = ['customer']) {
  return { id, roles, status: 'active', archivedAt: null };
}

function paidPayment(id, overrides = {}) {
  return {
    id,
    amount: 1000,
    paidAmount: 1000,
    status: 'paid',
    ...overrides,
  };
}

function runBackfill(overrides = {}) {
  return backfillPaymentAllocations({
    payments: [],
    paymentAllocations: [],
    rentals: [],
    ganttRentals: [],
    documents: [],
    clients: [],
    counterparties: [counterparty('CP-A'), counterparty('CP-B')],
    counterpartyRoleAssignments: [],
    nowIso: () => '2026-08-15T00:00:00.000Z',
    generateId: prefix => `${prefix}-TEST`,
    ...overrides,
  });
}

function allocationPairs(result) {
  return result.allocations.map(item => [item.paymentId, item.rentalId]);
}

test('startup backfill creates a direct Rental allocation only after both endpoints prove the same Counterparty', () => {
  const result = runBackfill({
    payments: [paidPayment('P-A', { rentalId: 'R-A', counterpartyId: 'CP-A' })],
    rentals: [{ id: 'R-A', counterpartyId: 'CP-A' }],
  });

  assert.equal(result.created, 1);
  assert.deepEqual(allocationPairs(result), [['P-A', 'R-A']]);
  assert.equal(result.summary.crossCounterparty, 0);
  assert.deepEqual(result.issues, []);
});

test('startup backfill preserves Document-to-Rental fallback after canonical relation proof', () => {
  const result = runBackfill({
    payments: [paidPayment('P-DOC', { documentId: 'D-A', counterpartyId: 'CP-A' })],
    documents: [{ id: 'D-A', rentalId: 'R-A' }],
    rentals: [{ id: 'R-A', counterpartyId: 'CP-A' }],
  });

  assert.equal(result.created, 1);
  assert.deepEqual(allocationPairs(result), [['P-DOC', 'R-A']]);
  assert.equal(result.allocations[0].documentId, 'D-A');
});

test('startup backfill accepts compatible canonical Client chains without using display metadata', () => {
  const result = runBackfill({
    clients: [{ id: 'C-A', counterpartyId: 'CP-A', company: 'Mutable label' }],
    payments: [paidPayment('P-CLIENT', {
      rentalId: 'R-CLIENT',
      clientId: 'C-A',
      client: 'Different payment label',
    })],
    rentals: [{
      id: 'R-CLIENT',
      clientId: 'C-A',
      client: 'Different rental label',
    }],
  });

  assert.equal(result.created, 1);
  assert.equal(result.allocations[0].clientId, 'C-A');
});

test('existing active or cancelled allocation suppresses backfill and no duplicate is created', () => {
  for (const status of ['active', 'cancelled']) {
    const existing = [{ id: `PA-${status}`, paymentId: 'P-A', rentalId: 'R-A', status }];
    const result = runBackfill({
      payments: [paidPayment('P-A', { rentalId: 'R-A', counterpartyId: 'CP-A' })],
      paymentAllocations: existing,
      rentals: [{ id: 'R-A', counterpartyId: 'CP-A' }],
    });

    assert.equal(result.created, 0);
    assert.equal(result.summary.alreadyAllocated, 1);
    assert.deepEqual(result.allocations, existing);
  }
});

test('startup backfill is idempotent when its first result is processed again', () => {
  const input = {
    payments: [paidPayment('P-A', { rentalId: 'R-A', counterpartyId: 'CP-A' })],
    rentals: [{ id: 'R-A', counterpartyId: 'CP-A' }],
  };
  const first = runBackfill(input);
  const second = runBackfill({ ...input, paymentAllocations: first.allocations });

  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.summary.alreadyAllocated, 1);
  assert.deepEqual(second.allocations, first.allocations);
});

test('direct cross-Counterparty Rental is rejected without changing raw allocations', () => {
  const original = [{ id: 'PA-OLD', paymentId: 'P-OLD', rentalId: 'R-OLD', status: 'active' }];
  const snapshot = structuredClone(original);
  const result = runBackfill({
    paymentAllocations: original,
    payments: [paidPayment('P-A', {
      rentalId: 'R-B',
      counterpartyId: 'CP-A',
      client: 'Same display label',
    })],
    rentals: [{ id: 'R-B', counterpartyId: 'CP-B', client: 'Same display label' }],
  });

  assert.equal(result.created, 0);
  assert.equal(result.summary.crossCounterparty, 1);
  assert.deepEqual(result.allocations, snapshot);
  assert.deepEqual(original, snapshot);
  assert.equal(result.issues[0].phase, 'counterparty_match');
});

test('Document-to-Rental cross-Counterparty candidate is rejected', () => {
  const result = runBackfill({
    payments: [paidPayment('P-A', { documentId: 'D-B', counterpartyId: 'CP-A' })],
    documents: [{ id: 'D-B', rentalId: 'R-B' }],
    rentals: [{ id: 'R-B', counterpartyId: 'CP-B' }],
  });

  assert.equal(result.created, 0);
  assert.equal(result.summary.crossCounterparty, 1);
  assert.deepEqual(result.allocations, []);
});

test('a missing direct Rental fails closed and does not fall back to a safe Document Rental', () => {
  const result = runBackfill({
    payments: [paidPayment('P-A', {
      rentalId: 'R-MISSING',
      documentId: 'D-A',
      counterpartyId: 'CP-A',
    })],
    documents: [{ id: 'D-A', rentalId: 'R-A' }],
    rentals: [{ id: 'R-A', counterpartyId: 'CP-A' }],
  });

  assert.equal(result.created, 0);
  assert.equal(result.summary.missingEndpoint, 1);
  assert.equal(result.issues[0].rentalId, 'R-MISSING');
});

test('missing Payment canonical identity is rejected even when Rental identity is valid', () => {
  const result = runBackfill({
    payments: [paidPayment('P-NO-ID', { rentalId: 'R-A', client: 'Display only' })],
    rentals: [{ id: 'R-A', counterpartyId: 'CP-A', client: 'Display only' }],
  });

  assert.equal(result.created, 0);
  assert.equal(result.summary.unresolvedPayment, 1);
  assert.equal(result.issues[0].phase, 'payment_identity');
});

test('missing Rental canonical identity is rejected even when Payment identity is valid', () => {
  const result = runBackfill({
    payments: [paidPayment('P-A', { rentalId: 'R-NO-ID', counterpartyId: 'CP-A' })],
    rentals: [{ id: 'R-NO-ID', client: 'Display only' }],
  });

  assert.equal(result.created, 0);
  assert.equal(result.summary.unresolvedRental, 1);
  assert.equal(result.issues[0].phase, 'rental_identity');
});

test('Payment and Rental dual-ID mismatches are rejected at their own canonical boundary', () => {
  const clients = [
    { id: 'C-A', counterpartyId: 'CP-A' },
    { id: 'C-B', counterpartyId: 'CP-B' },
  ];
  const paymentMismatch = runBackfill({
    clients,
    payments: [paidPayment('P-DUAL', {
      rentalId: 'R-A',
      clientId: 'C-A',
      counterpartyId: 'CP-B',
    })],
    rentals: [{ id: 'R-A', counterpartyId: 'CP-A' }],
  });
  const rentalMismatch = runBackfill({
    clients,
    payments: [paidPayment('P-A', { rentalId: 'R-DUAL', counterpartyId: 'CP-A' })],
    rentals: [{ id: 'R-DUAL', clientId: 'C-A', counterpartyId: 'CP-B' }],
  });

  assert.equal(paymentMismatch.created, 0);
  assert.equal(paymentMismatch.summary.unresolvedPayment, 1);
  assert.equal(paymentMismatch.issues[0].code, 'COUNTERPARTY_RELATION_MISMATCH');
  assert.equal(rentalMismatch.created, 0);
  assert.equal(rentalMismatch.summary.unresolvedRental, 1);
  assert.equal(rentalMismatch.issues[0].code, 'COUNTERPARTY_RELATION_MISMATCH');
});

test('missing Counterparty and missing Rental customer authority both fail closed', () => {
  const missingCounterparty = runBackfill({
    payments: [paidPayment('P-MISSING-CP', {
      rentalId: 'R-A',
      counterpartyId: 'CP-MISSING',
    })],
    rentals: [{ id: 'R-A', counterpartyId: 'CP-A' }],
  });
  const missingCustomerAuthority = runBackfill({
    counterparties: [counterparty('CP-SUPPLIER', ['supplier'])],
    payments: [paidPayment('P-SUPPLIER', {
      rentalId: 'R-SUPPLIER',
      counterpartyId: 'CP-SUPPLIER',
    })],
    rentals: [{ id: 'R-SUPPLIER', counterpartyId: 'CP-SUPPLIER' }],
  });

  assert.equal(missingCounterparty.created, 0);
  assert.equal(missingCounterparty.summary.unresolvedPayment, 1);
  assert.equal(missingCounterparty.issues[0].code, 'COUNTERPARTY_RELATION_COUNTERPARTY_NOT_FOUND');
  assert.equal(missingCustomerAuthority.created, 0);
  assert.equal(missingCustomerAuthority.summary.unresolvedRental, 1);
  assert.equal(missingCustomerAuthority.issues[0].code, 'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED');
});

test('Classic/Gantt exact-ID ambiguity and duplicate stable aliases are rejected', () => {
  const exactAmbiguity = runBackfill({
    payments: [paidPayment('P-EXACT', { rentalId: 'R-X', counterpartyId: 'CP-A' })],
    rentals: [{ id: 'R-X', counterpartyId: 'CP-A' }],
    ganttRentals: [{ id: 'R-X', counterpartyId: 'CP-A' }],
  });
  const aliasAmbiguity = runBackfill({
    payments: [paidPayment('P-ALIAS', { rentalId: 'LEGACY-X', counterpartyId: 'CP-A' })],
    rentals: [{ id: 'R-A', rentalId: 'LEGACY-X', counterpartyId: 'CP-A' }],
    ganttRentals: [{ id: 'GR-A', sourceRentalId: 'LEGACY-X', counterpartyId: 'CP-A' }],
  });

  assert.equal(exactAmbiguity.created, 0);
  assert.equal(exactAmbiguity.summary.ambiguous, 1);
  assert.equal(aliasAmbiguity.created, 0);
  assert.equal(aliasAmbiguity.summary.ambiguous, 1);
});

test('duplicate Payment and Document stable IDs are deterministic ambiguity blockers', () => {
  const duplicatePayment = paidPayment('P-DUP', { rentalId: 'R-A', counterpartyId: 'CP-A' });
  const paymentResult = runBackfill({
    payments: [duplicatePayment, { ...duplicatePayment }],
    rentals: [{ id: 'R-A', counterpartyId: 'CP-A' }],
  });
  const documentResult = runBackfill({
    payments: [paidPayment('P-DOC', { documentId: 'D-DUP', counterpartyId: 'CP-A' })],
    documents: [
      { id: 'D-DUP', rentalId: 'R-A' },
      { id: 'D-DUP', rentalId: 'R-A' },
    ],
    rentals: [{ id: 'R-A', counterpartyId: 'CP-A' }],
  });

  assert.equal(paymentResult.created, 0);
  assert.equal(paymentResult.summary.ambiguous, 2);
  assert.equal(documentResult.created, 0);
  assert.equal(documentResult.summary.ambiguous, 1);
});

test('mixed batch persists only safe candidates and summary classifies the cross-Counterparty blocker', () => {
  let generated = 0;
  const result = runBackfill({
    payments: [
      paidPayment('P-SAFE', { rentalId: 'R-A', counterpartyId: 'CP-A' }),
      paidPayment('P-CROSS', { rentalId: 'R-B', counterpartyId: 'CP-A' }),
    ],
    rentals: [
      { id: 'R-A', counterpartyId: 'CP-A' },
      { id: 'R-B', counterpartyId: 'CP-B' },
    ],
    generateId: prefix => `${prefix}-${++generated}`,
  });

  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.crossCounterparty, 1);
  assert.deepEqual(allocationPairs(result), [['P-SAFE', 'R-A']]);
  assert.equal(generated, 1);
});

test('unsafe diagnostics are deterministic and do not depend on generated IDs or timestamps', () => {
  const input = {
    payments: [paidPayment('P-CROSS', { rentalId: 'R-B', counterpartyId: 'CP-A' })],
    rentals: [{ id: 'R-B', counterpartyId: 'CP-B' }],
  };
  const first = runBackfill(input);
  const second = runBackfill({
    ...input,
    generateId: () => { throw new Error('unsafe candidate must not generate an ID'); },
    nowIso: () => { throw new Error('unsafe candidate must not generate a timestamp'); },
  });

  assert.deepEqual(second.summary, first.summary);
  assert.deepEqual(second.issues, first.issues);
  assert.deepEqual(second.allocations, []);
});
