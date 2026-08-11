import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const {
  COUNTERPARTY_RELATION_CODES,
  auditCounterpartyRelations,
  repairCounterpartyRelations,
  resolveClientCounterparty,
} = serverRequire('./lib/counterparty-relations');

function counterparty(id, overrides = {}) {
  return {
    id,
    legalName: `Контрагент ${id}`,
    shortName: id,
    inn: `7700000${id.replace(/\D/g, '').padStart(3, '0')}`.slice(0, 10),
    status: 'active',
    archivedAt: null,
    roles: ['customer'],
    ...overrides,
  };
}

function baseState(overrides = {}) {
  return {
    counterparties: [counterparty('CP-1')],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', company: 'ООО Клиент' }],
    client_objects: [],
    ...overrides,
  };
}

function storageFor(state) {
  return {
    readData: name => state[name] || [],
    writeDataBatch: entries => {
      for (const entry of entries) state[entry.name] = entry.value;
    },
  };
}

function hasIssue(list, domain, recordId, code) {
  return list.some(issue => (
    issue.domain === domain
    && issue.recordId === recordId
    && issue.code === code
  ));
}

test('audit reports healthy H1, H2 and H3 relations without repair work', () => {
  const state = baseState({
    counterparties: [
      counterparty('CP-1'),
      counterparty('CP-2', { roles: ['supplier'] }),
    ],
    client_objects: [
      { id: 'CO-neutral', counterpartyId: 'CP-2', name: 'Склад', address: 'Казань' },
      { id: 'CO-customer', clientId: 'C-1', counterpartyId: 'CP-1', name: 'Цех', address: 'Казань' },
    ],
  });

  const audit = auditCounterpartyRelations(state);

  assert.deepEqual(audit.healthy.map(item => item.classification).sort(), ['H1', 'H2', 'H3']);
  assert.equal(audit.repairable.length, 0);
  assert.equal(audit.broken.length, 0);
  assert.deepEqual(audit.summary.scanned, {
    counterparties: 2,
    clients: 1,
    clientObjects: 2,
  });
});

test('audit classifies missing Counterparty, missing Client and missing canonical ID', () => {
  const state = baseState({
    counterparties: [counterparty('CP-1')],
    clients: [
      { id: 'C-valid', counterpartyId: 'CP-1', company: 'Валидный' },
      { id: 'C-missing-cp', counterpartyId: 'CP-missing', company: 'Повреждённый' },
      { id: 'C-no-link', company: 'Legacy без canonical ID' },
    ],
    client_objects: [
      { id: 'CO-repairable', clientId: 'C-valid', name: 'Склад', address: 'Казань' },
      { id: 'CO-missing-client', clientId: 'C-missing', counterpartyId: 'CP-1', name: 'Офис', address: 'Казань' },
      { id: 'CO-missing-cp', counterpartyId: 'CP-missing', name: 'Цех', address: 'Казань' },
    ],
  });

  const audit = auditCounterpartyRelations(state);

  assert.equal(hasIssue(
    audit.broken,
    'clients',
    'C-missing-cp',
    COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND,
  ), true);
  assert.equal(hasIssue(
    audit.broken,
    'clients',
    'C-no-link',
    COUNTERPARTY_RELATION_CODES.CLIENT_LINK_MISSING,
  ), true);
  assert.equal(hasIssue(
    audit.broken,
    'client_objects',
    'CO-missing-client',
    COUNTERPARTY_RELATION_CODES.CLIENT_NOT_FOUND,
  ), true);
  assert.equal(hasIssue(
    audit.broken,
    'client_objects',
    'CO-missing-cp',
    COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND,
  ), true);
  assert.deepEqual(audit.repairable.map(issue => ({
    classification: issue.classification,
    recordId: issue.recordId,
    code: issue.code,
    nextValue: issue.repair.nextValue,
  })), [{
    classification: 'R1',
    recordId: 'CO-repairable',
    code: COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
    nextValue: 'CP-1',
  }]);
});

test('audit keeps mismatch, invalid customer role and archive violations broken', () => {
  const archived = counterparty('CP-archived', {
    status: 'archived',
    archivedAt: '2026-08-10T00:00:00.000Z',
  });
  const state = baseState({
    counterparties: [
      counterparty('CP-1'),
      counterparty('CP-2'),
      counterparty('CP-supplier', { roles: ['supplier'] }),
      archived,
    ],
    clients: [
      { id: 'C-1', counterpartyId: 'CP-1' },
      { id: 'C-role', counterpartyId: 'CP-supplier' },
      { id: 'C-archived', counterpartyId: 'CP-archived' },
    ],
    client_objects: [
      { id: 'CO-mismatch', clientId: 'C-1', counterpartyId: 'CP-2' },
      { id: 'CO-role', clientId: 'C-role' },
      { id: 'CO-active-archived', counterpartyId: 'CP-archived', status: 'active' },
      { id: 'CO-historical-archived', counterpartyId: 'CP-archived', status: 'archived' },
    ],
  });

  const audit = auditCounterpartyRelations(state);

  assert.equal(hasIssue(
    audit.broken,
    'client_objects',
    'CO-mismatch',
    COUNTERPARTY_RELATION_CODES.MISMATCH,
  ), true);
  assert.equal(hasIssue(
    audit.broken,
    'clients',
    'C-role',
    COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED,
  ), true);
  assert.equal(hasIssue(
    audit.broken,
    'client_objects',
    'CO-role',
    COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED,
  ), true);
  assert.equal(hasIssue(
    audit.broken,
    'clients',
    'C-archived',
    COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ARCHIVED,
  ), true);
  assert.equal(hasIssue(
    audit.broken,
    'client_objects',
    'CO-active-archived',
    COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ARCHIVED,
  ), true);
  assert.equal(audit.healthy.some(issue => (
    issue.recordId === 'CO-historical-archived' && issue.classification === 'H2'
  )), true);
  assert.equal(audit.repairable.length, 0);
});

test('name-only rows and duplicate names or INNs never become repair candidates', () => {
  const duplicateInn = '7707083893';
  const state = baseState({
    counterparties: [
      counterparty('CP-A', { legalName: 'ООО Дубль', shortName: 'Дубль', inn: duplicateInn }),
      counterparty('CP-B', { legalName: 'ООО Дубль', shortName: 'Дубль', inn: duplicateInn }),
    ],
    clients: [
      { id: 'C-A', company: 'ООО Дубль', inn: duplicateInn },
      { id: 'C-B', company: 'ООО Дубль', inn: duplicateInn },
    ],
    client_objects: [
      { id: 'CO-name-only', clientName: 'ООО Дубль', name: 'Склад', address: 'Казань' },
      { id: 'CO-inn-only', inn: duplicateInn, name: 'Офис', address: 'Казань' },
    ],
  });

  const before = structuredClone(state);
  const audit = auditCounterpartyRelations(state);
  const result = repairCounterpartyRelations({ ...storageFor(state), dryRun: false });

  assert.equal(audit.repairable.length, 0);
  assert.equal(hasIssue(
    audit.broken,
    'client_objects',
    'CO-name-only',
    COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
  ), true);
  assert.equal(hasIssue(
    audit.broken,
    'client_objects',
    'CO-inn-only',
    COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
  ), true);
  assert.equal(result.changed.length, 0);
  assert.deepEqual(state, before);
});

test('controlled repair dry-run reports R1 but performs no writes', () => {
  const state = baseState({
    client_objects: [{ id: 'CO-1', clientId: 'C-1', name: 'Склад', address: 'Казань' }],
  });
  const before = structuredClone(state);
  let writes = 0;

  const result = repairCounterpartyRelations({
    readData: name => state[name] || [],
    writeDataBatch: () => { writes += 1; },
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.changed.map(change => ({
    recordId: change.recordId,
    field: change.field,
    nextValue: change.nextValue,
    applied: change.applied,
  })), [{
    recordId: 'CO-1',
    field: 'counterpartyId',
    nextValue: 'CP-1',
    applied: false,
  }]);
  assert.equal(writes, 0);
  assert.deepEqual(state, before);
});

test('controlled repair mutates only counterpartyId, skips broken rows and is idempotent', () => {
  const state = baseState({
    counterparties: [counterparty('CP-1'), counterparty('CP-2')],
    client_objects: [
      { id: 'CO-safe', clientId: 'C-1', name: 'Склад', address: 'Казань', notes: 'preserve' },
      { id: 'CO-mismatch', clientId: 'C-1', counterpartyId: 'CP-2', name: 'Цех', address: 'Казань' },
      { id: 'CO-name-only', clientName: 'ООО Клиент', inn: '7707083893', name: 'Офис', address: 'Казань' },
    ],
  });
  const safeBefore = structuredClone(state.client_objects[0]);
  const clientsBefore = structuredClone(state.clients);
  const counterpartiesBefore = structuredClone(state.counterparties);
  const storage = storageFor(state);

  const first = repairCounterpartyRelations({ ...storage, dryRun: false });
  const second = repairCounterpartyRelations({ ...storage, dryRun: false });

  assert.equal(first.changed.length, 1);
  assert.equal(first.changed[0].applied, true);
  assert.deepEqual(state.client_objects[0], { ...safeBefore, counterpartyId: 'CP-1' });
  assert.equal(state.client_objects[1].counterpartyId, 'CP-2');
  assert.equal(state.client_objects[2].counterpartyId, undefined);
  assert.equal(hasIssue(
    first.skipped,
    'client_objects',
    'CO-mismatch',
    COUNTERPARTY_RELATION_CODES.MISMATCH,
  ), true);
  assert.equal(second.changed.length, 0);
  assert.equal(second.audit.healthy.some(issue => issue.recordId === 'CO-safe'), true);
  assert.deepEqual(state.clients, clientsBefore, 'repair must not create or mutate Client');
  assert.deepEqual(state.counterparties, counterpartiesBefore, 'repair must not create or mutate Counterparty');
});

test('duplicate stable IDs are ambiguous and canonical resolvers never choose the first match', () => {
  const state = baseState({
    counterparties: [
      counterparty('CP-duplicate', { legalName: 'Первый' }),
      counterparty('CP-duplicate', { legalName: 'Второй' }),
    ],
    clients: [{ id: 'C-1', counterpartyId: 'CP-duplicate' }],
    client_objects: [{ id: 'CO-1', clientId: 'C-1' }],
  });

  const audit = auditCounterpartyRelations(state);
  const repair = repairCounterpartyRelations({ ...storageFor(state), dryRun: false });

  assert.equal(audit.broken.some(issue => issue.code === COUNTERPARTY_RELATION_CODES.AMBIGUOUS), true);
  assert.equal(audit.repairable.length, 0);
  assert.equal(repair.changed.length, 0);
  assert.throws(
    () => resolveClientCounterparty('C-1', state),
    error => error.code === COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
  );
});
