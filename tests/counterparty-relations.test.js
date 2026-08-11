import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const {
  assertClientCounterpartyLink,
  ensureClientObjectCounterpartyLinks,
  resolveClientCounterparty,
  resolveDomainCounterpartyRelation,
} = serverRequire('./lib/counterparty-relations');

function counterparty(id, overrides = {}) {
  return {
    id,
    legalName: `Контрагент ${id}`,
    shortName: id,
    status: 'active',
    archivedAt: null,
    roles: ['customer'],
    ...overrides,
  };
}

function relationData(overrides = {}) {
  return {
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', company: 'ООО Клиент', inn: '7707083893' }],
    counterparties: [counterparty('CP-1')],
    ...overrides,
  };
}

function assertRelationError(fn, code) {
  assert.throws(fn, error => {
    assert.equal(error.code, code);
    assert.equal(error.status >= 400, true);
    return true;
  });
}

test('canonical relation resolver follows only Client.counterpartyId for a valid customer', () => {
  const data = relationData();
  const resolved = resolveClientCounterparty('C-1', data);

  assert.equal(resolved.client.id, 'C-1');
  assert.equal(resolved.counterparty.id, 'CP-1');
  assert.equal(resolved.counterpartyId, 'CP-1');
});

test('canonical relation resolver returns structured errors for every broken Client chain', () => {
  assertRelationError(
    () => resolveClientCounterparty('C-missing', relationData()),
    'COUNTERPARTY_RELATION_CLIENT_NOT_FOUND',
  );
  assertRelationError(
    () => resolveClientCounterparty('C-1', relationData({
      clients: [{ id: 'C-1', company: 'ООО Клиент' }],
    })),
    'COUNTERPARTY_RELATION_CLIENT_LINK_MISSING',
  );
  assertRelationError(
    () => resolveClientCounterparty('C-1', relationData({ counterparties: [] })),
    'COUNTERPARTY_RELATION_COUNTERPARTY_NOT_FOUND',
  );
  assertRelationError(
    () => resolveClientCounterparty('C-1', relationData({
      counterparties: [counterparty('CP-1', { status: 'archived', archivedAt: '2026-08-11T00:00:00.000Z' })],
    })),
    'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
  );
  assertRelationError(
    () => resolveClientCounterparty('C-1', relationData({
      counterparties: [counterparty('CP-1', { roles: ['supplier'] })],
    })),
    'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED',
  );
});

test('canonical relation resolver rejects dual-ID mismatch', () => {
  const data = relationData({
    counterparties: [counterparty('CP-1'), counterparty('CP-2')],
  });

  assertRelationError(
    () => assertClientCounterpartyLink({ clientId: 'C-1', counterpartyId: 'CP-2' }, data),
    'COUNTERPARTY_RELATION_MISMATCH',
  );
});

test('canonical relation resolver never recovers a relation from names or INN', () => {
  const data = relationData();

  assertRelationError(
    () => resolveDomainCounterpartyRelation({ client: 'ООО Клиент', clientName: 'ООО Клиент' }, data),
    'COUNTERPARTY_RELATION_ID_REQUIRED',
  );
  assertRelationError(
    () => resolveDomainCounterpartyRelation({ inn: '7707083893', clientInn: '7707083893' }, data),
    'COUNTERPARTY_RELATION_ID_REQUIRED',
  );
});

test('multi-role customer resolves to the same Counterparty while supplier-only neutral relation needs no Client', () => {
  const data = relationData({
    counterparties: [
      counterparty('CP-1', { roles: ['customer', 'supplier'] }),
      counterparty('CP-SUPPLIER', { roles: ['supplier'] }),
    ],
  });

  const customerSite = resolveDomainCounterpartyRelation({ clientId: 'C-1' }, data);
  const supplierSite = resolveDomainCounterpartyRelation({ counterpartyId: 'CP-SUPPLIER' }, data);

  assert.equal(customerSite.counterparty, data.counterparties[0]);
  assert.equal(supplierSite.counterparty, data.counterparties[1]);
  assert.equal(supplierSite.client, null);
  assert.equal(data.counterparties.length, 2);
  assert.equal(data.clients.length, 1);
});

test('client_objects foundation migration backfills by stable IDs, is idempotent, and skips corrupt rows', () => {
  const state = {
    ...relationData(),
    client_objects: [
      { id: 'CO-valid', clientId: 'C-1', name: 'Склад', address: 'Казань' },
      { id: 'CO-mismatch', clientId: 'C-1', counterpartyId: 'CP-2', name: 'Цех', address: 'Казань' },
      { id: 'CO-name-only', clientName: 'ООО Клиент', inn: '7707083893', name: 'Офис', address: 'Казань' },
    ],
  };
  state.counterparties.push(counterparty('CP-2'));
  const warnings = [];
  const readData = name => state[name] || [];
  const writeDataBatch = entries => {
    for (const entry of entries) state[entry.name] = entry.value;
  };

  const first = ensureClientObjectCounterpartyLinks({
    readData,
    writeDataBatch,
    logger: { log() {}, warn(message) { warnings.push(message); } },
  });
  const second = ensureClientObjectCounterpartyLinks({
    readData,
    writeDataBatch,
    logger: { log() {}, warn(message) { warnings.push(message); } },
  });

  assert.deepEqual({ linked: first.linked, issues: first.issues.length, changed: first.changed }, {
    linked: 1,
    issues: 2,
    changed: true,
  });
  assert.equal(state.client_objects[0].counterpartyId, 'CP-1');
  assert.equal(state.client_objects[1].counterpartyId, 'CP-2');
  assert.equal(state.client_objects[2].counterpartyId, undefined);
  assert.deepEqual({ linked: second.linked, issues: second.issues.length, changed: second.changed }, {
    linked: 0,
    issues: 2,
    changed: false,
  });
  assert.equal(warnings.some(message => message.includes('COUNTERPARTY_RELATION_MISMATCH')), true);
  assert.equal(warnings.some(message => message.includes('COUNTERPARTY_RELATION_ID_REQUIRED')), true);
});
