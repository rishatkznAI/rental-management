import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  REFERENCE_REGISTRY,
  STABLE_REFERENCE_FIELDS,
  analyzeClientObjectReferences,
  analyzeClientReferences,
  assertEntityOwnerScope,
  createClientMasterDataLifecycleService,
  findCounterpartyRoleRemovalBlockers,
} = require('../server/lib/client-master-data-lifecycle');
const {
  ROLE_ASSIGNMENTS_COLLECTION,
  SUPPLIER_PROFILES_COLLECTION,
  CONTRACTOR_PROFILES_COLLECTION,
} = require('../server/lib/counterparty-role-profiles');

const COMPANY = 'COMPANY-A';
const TENANT = 'TENANT-A';
const actor = {
  userId: 'U-ADMIN',
  userName: 'Администратор',
  userRole: 'Администратор',
  companyId: COMPANY,
  tenantId: TENANT,
};

function cp(overrides = {}) {
  return {
    id: 'CP-1',
    companyId: COMPANY,
    tenantId: TENANT,
    legalName: 'Stable owner',
    status: 'active',
    roles: ['customer'],
    archivedAt: null,
    ...overrides,
  };
}

function client(overrides = {}) {
  return {
    id: 'C-1',
    counterpartyId: 'CP-1',
    companyId: COMPANY,
    tenantId: TENANT,
    company: 'Editable display label',
    history: [],
    ...overrides,
  };
}

function object(overrides = {}) {
  return {
    id: 'CO-1',
    clientId: 'C-1',
    counterpartyId: 'CP-1',
    companyId: COMPANY,
    tenantId: TENANT,
    name: 'Site',
    status: 'active',
    ...overrides,
  };
}

function assignment(roleCode, overrides = {}) {
  return {
    id: `CPRA-${roleCode}`,
    counterpartyId: 'CP-1',
    roleCode,
    status: 'active',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: null,
    ...overrides,
  };
}

function makeStore(seed = {}, options = {}) {
  let state = structuredClone({
    counterparties: [cp()],
    clients: [client()],
    client_objects: [],
    [ROLE_ASSIGNMENTS_COLLECTION]: [assignment('customer')],
    [SUPPLIER_PROFILES_COLLECTION]: [],
    [CONTRACTOR_PROFILES_COLLECTION]: [],
    audit_logs: [],
    business_numbers: [{ scope: 'contracts', next: 278 }],
    number_sequences: [{ scope: 'service', next: 42 }],
    ...seed,
  });
  let failNextBatch = Boolean(options.failNextBatch);
  let id = 0;
  return {
    readData: name => state[name] || [],
    writeDataBatch(entries) {
      if (failNextBatch) {
        failNextBatch = false;
        throw new Error('simulated transaction failure');
      }
      const next = structuredClone(state);
      for (const entry of entries) next[entry.name] = structuredClone(entry.value);
      state = next;
    },
    generateId: prefix => `${prefix}-TEST-${++id}`,
    nowIso: () => '2026-08-24T12:00:00.000Z',
    snapshot: () => structuredClone(state),
    service() {
      return createClientMasterDataLifecycleService({
        readData: name => state[name] || [],
        writeDataBatch: this.writeDataBatch,
        generateId: this.generateId,
        nowIso: this.nowIso,
      });
    },
  };
}

function code(error, expected) {
  return error?.code === expected;
}

test('1. Client delete does not damage its shared Counterparty', () => {
  const store = makeStore();
  store.service().deleteClient({ id: 'C-1', actor });
  assert.equal(store.snapshot().clients.length, 0);
  assert.equal(store.snapshot().counterparties[0].id, 'CP-1');
});

test('2. Client with Contract reference cannot be deleted', () => {
  const store = makeStore({ client_contracts: [{ id: 'CC-1', clientId: 'C-1' }] });
  assert.throws(() => store.service().deleteClient({ id: 'C-1', actor }), error => code(error, 'CLIENT_HAS_HISTORY'));
});

test('3. Client with Rental reference cannot be deleted', () => {
  const store = makeStore({ rentals: [{ id: 'R-1', clientId: 'C-1', status: 'active' }] });
  assert.throws(() => store.service().deleteClient({ id: 'C-1', actor }), error => code(error, 'CLIENT_HAS_HISTORY'));
});

test('4. Client with Document reference cannot be deleted', () => {
  const store = makeStore({ documents: [{ id: 'D-1', clientId: 'C-1', status: 'issued' }] });
  assert.throws(() => store.service().deleteClient({ id: 'C-1', actor }), error => code(error, 'CLIENT_HAS_HISTORY'));
});

test('5. Client CRM activity and embedded history are durable blockers', () => {
  const store = makeStore({
    clients: [client({ history: [{ id: 'H-1', action: 'created' }] })],
    crm_activities: [{ id: 'A-1', clientId: 'C-1' }],
  });
  const analysis = analyzeClientReferences('C-1', { readData: store.readData });
  assert.deepEqual(new Set(analysis.blockers.map(item => item.collection)), new Set(['crm_activities', 'clients.history']));
});

test('6. Client without references deletes only the projection', () => {
  const store = makeStore();
  store.service().deleteClient({ id: 'C-1', actor });
  const state = store.snapshot();
  assert.deepEqual(state.clients, []);
  assert.equal(state.counterparties.length, 1);
  assert.equal(state[ROLE_ASSIGNMENTS_COLLECTION].length, 1);
});

test('7. Customer role does not change automatically on Client delete', () => {
  const store = makeStore();
  store.service().deleteClient({ id: 'C-1', actor });
  assert.equal(store.snapshot()[ROLE_ASSIGNMENTS_COLLECTION][0].status, 'active');
  assert.deepEqual(store.snapshot().counterparties[0].roles, ['customer']);
});

test('8. ACTIVE Client Object hard-delete is forbidden', () => {
  const store = makeStore({ client_objects: [object()] });
  assert.throws(() => store.service().deleteClientObject({ id: 'CO-1', actor }), error => code(error, 'CLIENT_OBJECT_ACTIVE'));
});

test('9. ARCHIVED Client Object without history can be deleted', () => {
  const store = makeStore({ client_objects: [object({ status: 'archived' })] });
  store.service().deleteClientObject({ id: 'CO-1', actor });
  assert.deepEqual(store.snapshot().client_objects, []);
});

test('10. ARCHIVED Client Object with history cannot be deleted', () => {
  const store = makeStore({
    client_objects: [object({ status: 'archived' })],
    service: [{ id: 'S-1', objectId: 'CO-1', status: 'closed' }],
  });
  assert.throws(() => store.service().deleteClientObject({ id: 'CO-1', actor }), error => code(error, 'CLIENT_OBJECT_HAS_HISTORY'));
});

test('11. Structured blockers contain collection and record ID', () => {
  const analysis = analyzeClientObjectReferences('CO-1', {
    client_objects: [object({ status: 'archived' })],
    documents: [{ id: 'D-OBJECT-1', clientObjectId: 'CO-1' }],
  });
  assert.equal(analysis.blockers[0].collection, 'documents');
  assert.equal(analysis.blockers[0].recordId, 'D-OBJECT-1');
});

test('12. Shared Counterparty supplier and contractor roles survive Client delete', () => {
  const store = makeStore({
    counterparties: [cp({ roles: ['customer', 'supplier', 'contractor'] })],
    [ROLE_ASSIGNMENTS_COLLECTION]: [assignment('customer'), assignment('supplier'), assignment('contractor')],
  });
  store.service().deleteClient({ id: 'C-1', actor });
  assert.deepEqual(store.snapshot().counterparties[0].roles, ['customer', 'supplier', 'contractor']);
});

test('13. Explicit customer deactivation preserves other roles and profiles', () => {
  const store = makeStore({
    clients: [],
    counterparties: [cp({ roles: ['customer', 'supplier', 'contractor'] })],
    [ROLE_ASSIGNMENTS_COLLECTION]: [assignment('customer'), assignment('supplier'), assignment('contractor')],
    [SUPPLIER_PROFILES_COLLECTION]: [{ id: 'SUPP-1', counterpartyId: 'CP-1', status: 'active' }],
    [CONTRACTOR_PROFILES_COLLECTION]: [{ id: 'CONT-1', counterpartyId: 'CP-1', status: 'active' }],
  });
  store.service().deactivateCustomerRole({ id: 'CP-1', actor });
  const state = store.snapshot();
  assert.deepEqual(state.counterparties[0].roles, ['supplier', 'contractor']);
  assert.equal(state[SUPPLIER_PROFILES_COLLECTION][0].status, 'active');
  assert.equal(state[CONTRACTOR_PROFILES_COLLECTION][0].status, 'active');
});

test('14. Counterparty with business references cannot be archived or customer-deactivated', () => {
  const store = makeStore({ rentals: [{ id: 'R-CP', counterpartyId: 'CP-1', status: 'active' }] });
  assert.throws(() => store.service().archiveCounterparty({ id: 'CP-1', actor }), error => code(error, 'COUNTERPARTY_IN_USE'));
  assert.throws(() => store.service().deactivateCustomerRole({ id: 'CP-1', actor }), error => code(error, 'COUNTERPARTY_IN_USE'));
});

test('15. Cross-company mutation is forbidden', () => {
  const store = makeStore();
  const foreignActor = { ...actor, companyId: 'COMPANY-B' };
  assert.throws(() => store.service().deleteClient({ id: 'C-1', actor: foreignActor }), error => code(error, 'CLIENT_SCOPE_FORBIDDEN'));
  assert.throws(() => assertEntityOwnerScope({ actor: foreignActor, entityType: 'client', entity: client(), readData: store.readData }), error => code(error, 'CLIENT_SCOPE_FORBIDDEN'));
});

test('16. Cross-tenant mutation is forbidden', () => {
  const store = makeStore();
  const foreignActor = { ...actor, tenantId: 'TENANT-B' };
  assert.throws(() => store.service().deleteClient({ id: 'C-1', actor: foreignActor }), error => code(error, 'CLIENT_SCOPE_FORBIDDEN'));
});

test('17. Unknown legacy scope fails closed', () => {
  const store = makeStore({
    counterparties: [cp({ companyId: undefined, tenantId: undefined })],
    clients: [client({ companyId: undefined, tenantId: undefined })],
  });
  assert.throws(() => store.service().deleteClient({ id: 'C-1', actor }), error => code(error, 'CLIENT_SCOPE_UNKNOWN'));

  const partialStore = makeStore({
    counterparties: [cp({ tenantId: undefined })],
    clients: [client({ tenantId: undefined })],
  });
  assert.throws(
    () => partialStore.service().deleteClient({ id: 'C-1', actor }),
    error => code(error, 'CLIENT_SCOPE_UNKNOWN') && error.details?.field === 'tenantId',
  );
});

test('18. Mutation and audit state roll back together on batch failure', () => {
  const store = makeStore({}, { failNextBatch: true });
  const before = store.snapshot();
  assert.throws(() => store.service().deleteClient({ id: 'C-1', actor }), /transaction failure/);
  assert.deepEqual(store.snapshot(), before);
});

test('19. Archive replay is idempotent', () => {
  const store = makeStore({ client_objects: [object()] });
  const lifecycle = store.service();
  assert.equal(lifecycle.archiveClientObject({ id: 'CO-1', actor }).changed, true);
  assert.equal(lifecycle.archiveClientObject({ id: 'CO-1', actor }).changed, false);
  assert.equal(store.snapshot().client_objects[0].status, 'archived');
});

test('20. Replay does not duplicate lifecycle audit activity', () => {
  const store = makeStore({ client_objects: [object()] });
  const lifecycle = store.service();
  lifecycle.archiveClientObject({ id: 'CO-1', actor });
  lifecycle.archiveClientObject({ id: 'CO-1', actor });
  assert.equal(store.snapshot().audit_logs.filter(item => item.action === 'client_objects.archive').length, 1);
});

test('21. Existing Contract/Rental/Document links remain valid after blocked deletion', () => {
  const store = makeStore({
    client_contracts: [{ id: 'CC-1', clientId: 'C-1' }],
    rentals: [{ id: 'R-1', clientId: 'C-1' }],
    documents: [{ id: 'D-1', clientId: 'C-1' }],
  });
  const before = store.snapshot();
  assert.throws(() => store.service().deleteClient({ id: 'C-1', actor }));
  assert.deepEqual(store.snapshot(), before);
});

test('22. Reference registry covers required domains and stable fields', () => {
  const collections = new Set(REFERENCE_REGISTRY.map(item => item.collection));
  for (const required of [
    'rentals', 'gantt_rentals', 'rental_change_requests', 'client_contracts', 'documents',
    'payments', 'payment_allocations', 'deliveries', 'service', 'warranty_claims',
    'crm_activities', 'debt_collection_plans', 'receivable_payment_plans', 'client_objects',
    'audit_logs', 'domain_history',
  ]) assert.equal(collections.has(required), true, required);
  assert.deepEqual(STABLE_REFERENCE_FIELDS, ['counterpartyId', 'clientId', 'objectId', 'clientObjectId', 'siteId', 'objectIds']);
});

test('23. Generic CRUD contains no Client/Object cascade or force-delete route', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/routes/crud.js'), 'utf8');
  assert.match(source, /DOMAIN_LIFECYCLE_ENDPOINT_REQUIRED/);
  assert.match(source, /DOMAIN_LIFECYCLE_BULK_DELETE_FORBIDDEN/);
  assert.match(source, /collection === 'clients' \|\| collection === 'client_objects'/);
  assert.doesNotMatch(source, /forceDeleteClient|cascadeDeleteClient|findClientObjectHistoryLinks/);
});

test('24. Lifecycle batches do not modify numbering state', () => {
  const store = makeStore();
  const before = store.snapshot();
  store.service().deleteClient({ id: 'C-1', actor });
  assert.deepEqual(store.snapshot().business_numbers, before.business_numbers);
  assert.deepEqual(store.snapshot().number_sequences, before.number_sequences);
});

test('25. Last customer role with zero references soft-archives instead of deleting Counterparty', () => {
  const store = makeStore({ clients: [] });
  store.service().deactivateCustomerRole({ id: 'CP-1', actor });
  const state = store.snapshot();
  assert.equal(state.counterparties.length, 1);
  assert.equal(state.counterparties[0].status, 'archived');
  assert.equal(state[ROLE_ASSIGNMENTS_COLLECTION][0].status, 'inactive');
});

test('26. Name-only legacy labels are never treated as stable references', () => {
  const analysis = analyzeClientReferences('C-1', {
    clients: [client()],
    documents: [{ id: 'D-NAME', client: 'Editable display label' }],
  });
  assert.equal(analysis.blockers.length, 0);
});

test('27. Conflicting canonical owner scopes fail closed', () => {
  const store = makeStore({ counterparties: [cp({ companyId: 'COMPANY-B' })] });
  assert.throws(() => store.service().deleteClient({ id: 'C-1', actor }), error => code(error, 'CLIENT_SCOPE_CONFLICT'));
});

test('28. Audit history is retained but does not by itself block safe cleanup', () => {
  const store = makeStore({
    audit_logs: [{ id: 'AUD-OLD', entityType: 'clients', entityId: 'C-1' }],
  });
  const result = store.service().deleteClient({ id: 'C-1', actor });
  assert.equal(result.changed, true);
  assert.equal(store.snapshot().audit_logs.some(item => item.id === 'AUD-OLD'), true);
});

test('29. Automatic Client creation audit alone does not make a pristine projection immortal', () => {
  const store = makeStore({
    clients: [client({ history: [{ date: '2026-01-01', type: 'system', text: 'Клиент создан: ООО Тест' }] })],
  });
  assert.equal(store.service().deleteClient({ id: 'C-1', actor }).changed, true);
});

test('30. Warranty stable Service chain participates in the unified customer-role registry', () => {
  const store = makeStore({
    service: [{ id: 'S-1', counterpartyId: 'CP-1', clientId: 'C-1', status: 'new' }],
    warranty_claims: [{ id: 'W-DERIVED', serviceTicketId: 'S-1', status: 'parts_shipping' }],
  });
  const blockers = findCounterpartyRoleRemovalBlockers({
    counterpartyId: 'CP-1',
    roleCode: 'customer',
    data: { readData: store.readData },
  });
  const warranty = blockers.find(item => item.collection === 'warranty_claims');
  assert.deepEqual(warranty?.recordIds, ['W-DERIVED']);
  assert.deepEqual(warranty?.relationFields, ['serviceTicketId']);
});
