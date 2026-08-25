import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const {
  CONTRACTOR_PROFILES_COLLECTION,
  ROLE_ASSIGNMENTS_COLLECTION,
  ROLE_PROFILE_CODES,
  SUPPLIER_PROFILES_COLLECTION,
  activateCounterpartyRole,
  auditCounterpartyRoleProfiles,
  boundaryState,
  deactivateCounterpartyRole,
  ensureCounterpartyRoleProfileFoundation,
  prepareCounterpartyRoleProfileFoundation,
} = serverRequire('./lib/counterparty-role-profiles');
const { resolveClientCounterparty } = serverRequire('./lib/counterparty-relations');

const NOW = '2026-08-11T12:00:00.000Z';

function counterparty(id, roles) {
  return {
    id,
    companyId: 'COMPANY-A',
    tenantId: 'COMPANY-A',
    type: 'legal_entity',
    legalName: `ООО ${id}`,
    shortName: id,
    inn: `7700000${id.replace(/\D/g, '').padStart(3, '0')}`.slice(0, 10),
    kpp: null,
    ogrn: null,
    ogrnip: null,
    legalAddress: null,
    actualAddress: null,
    email: null,
    phone: null,
    website: null,
    notes: null,
    status: 'active',
    roles,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };
}

function data(overrides = {}) {
  return {
    counterparties: [],
    clients: [],
    [ROLE_ASSIGNMENTS_COLLECTION]: [],
    [SUPPLIER_PROFILES_COLLECTION]: [],
    [CONTRACTOR_PROFILES_COLLECTION]: [],
    rentals: [],
    gantt_rentals: [],
    rental_change_requests: [],
    payments: [],
    payment_allocations: [],
    documents: [],
    client_objects: [],
    client_contracts: [],
    deliveries: [],
    delivery_carriers: [],
    service: [],
    warranty_claims: [],
    crm_deals: [],
    crm_activities: [],
    debt_collection_plans: [],
    debt_collection_actions: [],
    receivable_payment_plans: [],
    company_expenses: [],
    finance_operations: [],
    spare_parts: [],
    service_field_trips: [],
    ...overrides,
  };
}

function migrate(state) {
  return ensureCounterpartyRoleProfileFoundation({
    readData: name => state[name] || [],
    writeDataBatch: entries => {
      for (const entry of entries) state[entry.name] = entry.value;
    },
    dryRun: false,
    nowIso: () => NOW,
  });
}

const ROLE_COMBINATIONS = [
  ['customer'],
  ['supplier'],
  ['contractor'],
  ['customer', 'supplier'],
  ['customer', 'contractor'],
  ['supplier', 'contractor'],
  ['customer', 'supplier', 'contractor'],
];

for (const roles of ROLE_COMBINATIONS) {
  test(`role/profile foundation supports ${roles.join(' + ')}`, () => {
    const state = data({ counterparties: [counterparty(`CP-${roles.join('-')}`, roles)] });
    const result = migrate(state);

    assert.equal(result.wrote, true);
    assert.deepEqual(
      state[ROLE_ASSIGNMENTS_COLLECTION].filter(item => item.status === 'active').map(item => item.roleCode),
      roles,
    );
    assert.equal(state.clients.length, 0, 'customer role must not require a synthetic Client');
    assert.equal(state[SUPPLIER_PROFILES_COLLECTION].length, roles.includes('supplier') ? 1 : 0);
    assert.equal(state[CONTRACTOR_PROFILES_COLLECTION].length, roles.includes('contractor') ? 1 : 0);
    assert.equal(result.audit.ok, true);
  });
}

test('one Counterparty gets at most one role profile and repeated activation is idempotent', () => {
  const state = boundaryState(data({ counterparties: [counterparty('CP-1', ['supplier'])] }));
  const first = activateCounterpartyRole({
    state,
    counterpartyId: 'CP-1',
    roleCode: 'supplier',
    actor: { userId: 'U-1' },
    nowIso: () => NOW,
  });
  const second = activateCounterpartyRole({
    state,
    counterpartyId: 'CP-1',
    roleCode: 'supplier',
    actor: { userId: 'U-1' },
    nowIso: () => NOW,
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(state[ROLE_ASSIGNMENTS_COLLECTION].length, 1);
  assert.equal(state[SUPPLIER_PROFILES_COLLECTION].length, 1);
  assert.equal(state.clients.length, 0);
});

test('adding contractor cannot resurrect inactive supplier from a stale roles projection', () => {
  const raw = data({ counterparties: [counterparty('CP-1', ['customer', 'supplier'])] });
  migrate(raw);
  const state = boundaryState(raw);
  deactivateCounterpartyRole({
    state,
    data: state,
    counterpartyId: 'CP-1',
    roleCode: 'supplier',
    nowIso: () => NOW,
  });
  const inactiveAssignment = structuredClone(
    state[ROLE_ASSIGNMENTS_COLLECTION].find(item => item.roleCode === 'supplier'),
  );
  const inactiveProfile = structuredClone(state[SUPPLIER_PROFILES_COLLECTION][0]);
  state.counterparties[0] = {
    ...state.counterparties[0],
    roles: ['customer', 'supplier'],
  };

  activateCounterpartyRole({
    state,
    counterpartyId: 'CP-1',
    roleCode: 'contractor',
    nowIso: () => NOW,
  });

  assert.deepEqual(
    state[ROLE_ASSIGNMENTS_COLLECTION].find(item => item.roleCode === 'supplier'),
    inactiveAssignment,
  );
  assert.deepEqual(state[SUPPLIER_PROFILES_COLLECTION][0], inactiveProfile);
  assert.equal(
    state[ROLE_ASSIGNMENTS_COLLECTION].find(item => item.roleCode === 'contractor').status,
    'active',
  );
  assert.deepEqual(state.counterparties[0].roles, ['customer', 'contractor']);
});

test('existing inactive assignment wins over roles projection during compatibility foundation', () => {
  const inactiveAssignment = {
    id: 'A-supplier',
    counterpartyId: 'CP-1',
    roleCode: 'supplier',
    status: 'inactive',
    validFrom: NOW,
    validTo: NOW,
  };
  const inactiveProfile = {
    id: 'SP-1',
    counterpartyId: 'CP-1',
    status: 'inactive',
    archivedAt: NOW,
  };
  const state = data({
    counterparties: [counterparty('CP-1', ['supplier'])],
    [ROLE_ASSIGNMENTS_COLLECTION]: [inactiveAssignment],
    [SUPPLIER_PROFILES_COLLECTION]: [inactiveProfile],
  });

  const prepared = prepareCounterpartyRoleProfileFoundation({ data: state, nowIso: () => NOW });

  assert.deepEqual(prepared.state[ROLE_ASSIGNMENTS_COLLECTION], [inactiveAssignment]);
  assert.deepEqual(prepared.state[SUPPLIER_PROFILES_COLLECTION], [inactiveProfile]);
  assert.deepEqual(prepared.state.counterparties[0].roles, []);
});

test('compatibility foundation bootstraps a true legacy role with no assignment', () => {
  const state = data({ counterparties: [counterparty('CP-1', ['supplier'])] });

  const prepared = prepareCounterpartyRoleProfileFoundation({ data: state, nowIso: () => NOW });

  assert.equal(prepared.state[ROLE_ASSIGNMENTS_COLLECTION].length, 1);
  assert.equal(prepared.state[ROLE_ASSIGNMENTS_COLLECTION][0].roleCode, 'supplier');
  assert.equal(prepared.state[ROLE_ASSIGNMENTS_COLLECTION][0].status, 'active');
  assert.equal(prepared.state[SUPPLIER_PROFILES_COLLECTION].length, 1);
  assert.equal(prepared.state[SUPPLIER_PROFILES_COLLECTION][0].status, 'active');
  assert.deepEqual(prepared.state.counterparties[0].roles, ['supplier']);
});

test('foundation migration is idempotent and uses stable Client.counterpartyId only', () => {
  const state = data({
    counterparties: [counterparty('CP-1', ['supplier'])],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', company: 'Display only', status: 'active' }],
  });
  const first = migrate(state);
  const snapshot = structuredClone(state);
  const second = migrate(state);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.deepEqual(state, snapshot);
  assert.deepEqual(state.counterparties[0].roles, ['customer', 'supplier']);
  assert.equal(state[ROLE_ASSIGNMENTS_COLLECTION].length, 2);
  assert.equal(state[SUPPLIER_PROFILES_COLLECTION].length, 1);
});

test('new-format import keeps RoleAssignment authoritative over a stale roles projection', () => {
  const state = data({
    counterparties: [counterparty('CP-1', ['customer', 'supplier'])],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', status: 'active' }],
    [ROLE_ASSIGNMENTS_COLLECTION]: [
      { id: 'A-customer', counterpartyId: 'CP-1', roleCode: 'customer', status: 'active', validFrom: NOW, validTo: null },
      { id: 'A-supplier', counterpartyId: 'CP-1', roleCode: 'supplier', status: 'inactive', validFrom: NOW, validTo: NOW },
    ],
    [SUPPLIER_PROFILES_COLLECTION]: [{ id: 'SP-1', counterpartyId: 'CP-1', status: 'inactive', archivedAt: NOW }],
  });
  const prepared = prepareCounterpartyRoleProfileFoundation({
    data: state,
    assignmentsAuthoritative: true,
    nowIso: () => NOW,
  });

  assert.deepEqual(prepared.state.counterparties[0].roles, ['customer']);
  assert.equal(prepared.state[ROLE_ASSIGNMENTS_COLLECTION][1].status, 'inactive');
  assert.equal(prepared.state[SUPPLIER_PROFILES_COLLECTION][0].status, 'inactive');
  assert.equal(prepared.audit.ok, true);
});

test('audit detects duplicate profiles, role/profile mismatches and conflicting roles projection', () => {
  const state = data({
    counterparties: [counterparty('CP-1', ['customer', 'supplier'])],
    clients: [
      { id: 'C-1', counterpartyId: 'CP-1', status: 'active' },
      { id: 'C-2', counterpartyId: 'CP-1', status: 'active' },
    ],
    [ROLE_ASSIGNMENTS_COLLECTION]: [{
      id: 'A-1', counterpartyId: 'CP-1', roleCode: 'supplier', status: 'active', validFrom: NOW, validTo: null,
    }],
  });
  const audit = auditCounterpartyRoleProfiles(state);
  const codes = new Set(audit.errors.map(issue => issue.code));

  assert.equal(audit.ok, false);
  assert.equal(codes.has(ROLE_PROFILE_CODES.CUSTOMER_PROFILE_DUPLICATE), true);
  assert.equal(codes.has(ROLE_PROFILE_CODES.CUSTOMER_PROFILE_WITHOUT_ROLE), true);
  assert.equal(codes.has(ROLE_PROFILE_CODES.ROLE_WITHOUT_PROFILE), true);
  assert.equal(codes.has(ROLE_PROFILE_CODES.PROJECTION_CONFLICT), true);
});

test('audit detects duplicate stable IDs and profiles pointing to missing Counterparty', () => {
  const state = data({
    counterparties: [counterparty('CP-1', ['supplier']), counterparty('CP-1', ['supplier'])],
    [SUPPLIER_PROFILES_COLLECTION]: [{
      id: 'SUP-1', counterpartyId: 'CP-missing', status: 'active', categories: [],
    }],
  });
  const audit = auditCounterpartyRoleProfiles(state);

  assert.equal(audit.errors.some(issue => issue.code === ROLE_PROFILE_CODES.DUPLICATE_STABLE_ID), true);
  assert.equal(audit.errors.some(issue => issue.code === ROLE_PROFILE_CODES.PROFILE_COUNTERPARTY_MISSING), true);
});

test('role assignment authority fails closed when legacy roles projection is stale', () => {
  const state = data({
    counterparties: [counterparty('CP-1', ['customer', 'supplier'])],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', status: 'active' }],
    [ROLE_ASSIGNMENTS_COLLECTION]: [
      { id: 'A-customer', counterpartyId: 'CP-1', roleCode: 'customer', status: 'inactive', validFrom: NOW, validTo: NOW },
      { id: 'A-supplier', counterpartyId: 'CP-1', roleCode: 'supplier', status: 'active', validFrom: NOW, validTo: null },
    ],
    [SUPPLIER_PROFILES_COLLECTION]: [{ id: 'SP-1', counterpartyId: 'CP-1', status: 'active' }],
  });

  assert.throws(
    () => resolveClientCounterparty('C-1', state),
    error => error.code === 'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED',
  );
  assert.equal(
    auditCounterpartyRoleProfiles(state).errors.some(issue => issue.code === ROLE_PROFILE_CODES.PROJECTION_CONFLICT),
    true,
  );
});

test('role removal without durable references deactivates assignment and profile without deletion', () => {
  const raw = data({ counterparties: [counterparty('CP-1', ['customer', 'supplier'])] });
  migrate(raw);
  const state = boundaryState(raw);
  const supplierProfileId = state[SUPPLIER_PROFILES_COLLECTION][0].id;
  const result = deactivateCounterpartyRole({
    state,
    data: raw,
    counterpartyId: 'CP-1',
    roleCode: 'supplier',
    actor: { userId: 'U-1' },
    reason: 'commercial relationship ended',
    nowIso: () => NOW,
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.counterparty.roles, ['customer']);
  assert.equal(state[ROLE_ASSIGNMENTS_COLLECTION].find(item => item.roleCode === 'supplier').status, 'inactive');
  assert.equal(state[SUPPLIER_PROFILES_COLLECTION][0].id, supplierProfileId);
  assert.equal(state[SUPPLIER_PROFILES_COLLECTION][0].status, 'inactive');
});

test('role removal is blocked by durable stable-ID references and audit reports the constraint', () => {
  const raw = data({
    counterparties: [counterparty('CP-1', ['customer', 'supplier'])],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', status: 'active' }],
    rentals: [{ id: 'R-1', counterpartyId: 'CP-1', clientId: 'C-1', status: 'active' }],
  });
  migrate(raw);
  const state = boundaryState(raw);

  assert.throws(() => deactivateCounterpartyRole({
    state,
    data: raw,
    counterpartyId: 'CP-1',
    roleCode: 'customer',
    nowIso: () => NOW,
  }), error => {
    assert.equal(error.code, ROLE_PROFILE_CODES.ROLE_REMOVAL_BLOCKED);
    assert.equal(error.details.blockers.some(item => item.collection === 'rentals'), true);
    return true;
  });
  const audit = auditCounterpartyRoleProfiles(raw);
  assert.equal(audit.roleRemovalConstraints.some(item => (
    item.counterpartyId === 'CP-1'
    && item.roleCode === 'customer'
    && item.blockers.some(blocker => blocker.collection === 'rentals')
  )), true);
});

test('active Service relation blocks customer-role removal while terminal history does not', () => {
  const raw = data({
    counterparties: [counterparty('CP-1', ['customer', 'supplier'])],
    service: [{ id: 'S-1', counterpartyId: 'CP-1', status: 'needs_revision' }],
  });
  migrate(raw);
  let state = boundaryState(raw);

  assert.throws(() => deactivateCounterpartyRole({
    state,
    data: raw,
    counterpartyId: 'CP-1',
    roleCode: 'customer',
    nowIso: () => NOW,
  }), error => {
    assert.equal(error.code, ROLE_PROFILE_CODES.ROLE_REMOVAL_BLOCKED);
    assert.equal(error.details.blockers.some(item => item.collection === 'service' && item.recordIds.includes('S-1')), true);
    return true;
  });

  raw.service[0].status = 'closed';
  state = boundaryState(raw);
  const result = deactivateCounterpartyRole({
    state,
    data: raw,
    counterpartyId: 'CP-1',
    roleCode: 'customer',
    nowIso: () => NOW,
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.counterparty.roles, ['supplier']);
});

test('active Warranty factory relation blocks supplier-role/profile deactivation while terminal history does not', () => {
  const raw = data({
    counterparties: [counterparty('CP-1', ['customer', 'supplier'])],
    warranty_claims: [{ id: 'W-factory', factoryCounterpartyId: 'CP-1', status: 'factory_review' }],
  });
  migrate(raw);
  let state = boundaryState(raw);

  assert.throws(() => deactivateCounterpartyRole({
    state,
    data: raw,
    counterpartyId: 'CP-1',
    roleCode: 'supplier',
    nowIso: () => NOW,
  }), error => {
    assert.equal(error.code, ROLE_PROFILE_CODES.ROLE_REMOVAL_BLOCKED);
    assert.equal(error.details.blockers.some(item => (
      item.collection === 'warranty_claims'
      && item.relationFields.includes('factoryCounterpartyId')
      && item.recordIds.includes('W-factory')
    )), true);
    return true;
  });

  raw.warranty_claims[0].status = 'closed';
  state = boundaryState(raw);
  const result = deactivateCounterpartyRole({
    state,
    data: raw,
    counterpartyId: 'CP-1',
    roleCode: 'supplier',
    nowIso: () => NOW,
  });
  assert.equal(result.changed, true);
  assert.equal(state[SUPPLIER_PROFILES_COLLECTION][0].status, 'inactive');
});

test('terminal Service contractor reference still blocks contractor-role removal', () => {
  const raw = data({
    counterparties: [counterparty('CP-1', ['customer', 'contractor'])],
    service: [{ id: 'S-1', contractorCounterpartyId: 'CP-1', status: 'closed' }],
  });
  migrate(raw);

  assert.throws(() => deactivateCounterpartyRole({
    state: boundaryState(raw),
    data: raw,
    counterpartyId: 'CP-1',
    roleCode: 'contractor',
    nowIso: () => NOW,
  }), error => {
    assert.equal(error.code, ROLE_PROFILE_CODES.ROLE_REMOVAL_BLOCKED);
    assert.equal(error.details.blockers.some(item => (
      item.collection === 'service'
      && item.recordIds.includes('S-1')
      && item.relationFields.includes('contractorCounterpartyId')
    )), true);
    return true;
  });
});

test('supplier and contractor removal fail closed for role-ambiguous Payment references', () => {
  const raw = data({
    counterparties: [counterparty('CP-1', ['customer', 'supplier', 'contractor'])],
    payments: [{ id: 'P-1', counterpartyId: 'CP-1', amount: 100 }],
  });
  migrate(raw);
  for (const roleCode of ['supplier', 'contractor']) {
    assert.throws(() => deactivateCounterpartyRole({
      state: boundaryState(raw),
      data: raw,
      counterpartyId: 'CP-1',
      roleCode,
      nowIso: () => NOW,
    }), error => {
      assert.equal(error.code, ROLE_PROFILE_CODES.ROLE_REMOVAL_BLOCKED);
      assert.equal(error.details.blockers[0].ambiguity.includes('fails closed'), true);
      return true;
    });
  }
});

test('ambiguous legacy supplier and carrier names are diagnostics only and never repaired', () => {
  const state = data({
    counterparties: [
      { ...counterparty('CP-S1', ['supplier']), legalName: 'ООО Дубль', shortName: 'Дубль' },
      { ...counterparty('CP-S2', ['supplier']), legalName: 'ООО Дубль', shortName: 'Дубль' },
      { ...counterparty('CP-C1', ['contractor']), legalName: 'ООО Транспорт', shortName: 'Транспорт' },
      { ...counterparty('CP-C2', ['contractor']), legalName: 'ООО Транспорт', shortName: 'Транспорт' },
    ],
    spare_parts: [{ id: 'PART-1', supplier: 'Дубль' }],
    delivery_carriers: [{ id: 'DC-1', company: 'Транспорт', name: 'Транспорт' }],
  });
  migrate(state);
  const before = structuredClone({ spare_parts: state.spare_parts, delivery_carriers: state.delivery_carriers });
  const audit = auditCounterpartyRoleProfiles(state);

  assert.equal(audit.warnings.some(issue => issue.code === ROLE_PROFILE_CODES.AMBIGUOUS_LEGACY_SUPPLIER_MAPPING), true);
  assert.equal(audit.warnings.some(issue => issue.code === ROLE_PROFILE_CODES.AMBIGUOUS_LEGACY_CONTRACTOR_MAPPING), true);
  assert.deepEqual({ spare_parts: state.spare_parts, delivery_carriers: state.delivery_carriers }, before);
});
