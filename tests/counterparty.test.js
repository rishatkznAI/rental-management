import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const {
  deterministicCounterpartyId,
  ensureClientCounterpartyFoundation,
  prepareClientCompatibilityCreate,
  prepareClientCompatibilityUpdate,
} = serverRequire('./lib/counterparty');
const { registerCounterpartyRoutes } = serverRequire('./routes/counterparties');

function legalEntity(overrides = {}) {
  return {
    type: 'legal_entity',
    legalName: 'ООО Ромашка',
    shortName: 'Ромашка',
    inn: '1655 123456',
    kpp: '165501001',
    roles: ['customer'],
    ...overrides,
  };
}

function createState(overrides = {}) {
  return {
    counterparties: [],
    clients: [],
    client_objects: [],
    rentals: [],
    payments: [],
    documents: [],
    service: [],
    ...overrides,
  };
}

function createApp(state = createState(), { denyWrite = false } = {}) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  let sequence = 0;
  const router = express.Router();
  registerCounterpartyRoutes(router, {
    readData,
    writeData,
    writeDataBatch: entries => {
      for (const entry of entries) writeData(entry.name, entry.value);
    },
    requireAuth: (req, _res, next) => {
      req.user = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };
      next();
    },
    requireRead: () => (_req, _res, next) => next(),
    requireWrite: () => (_req, res, next) => (
      denyWrite ? res.status(403).json({ ok: false, code: 'FORBIDDEN' }) : next()
    ),
    generateId: prefix => `${prefix}-${++sequence}`,
    nowIso: () => '2026-08-10T12:00:00.000Z',
    auditLog: () => {},
  });
  app.use('/api', router);
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const address = server.address();
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  return { status: response.status, body: payload };
}

test('Counterparty API creates, reads and updates a stable entity with customer and supplier roles', async () => {
  const state = createState();
  const app = createApp(state);

  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({
      roles: ['supplier', 'customer', 'supplier'],
    }));
    assert.equal(created.status, 201);
    assert.equal(created.body.id, 'CP-1');
    assert.equal(created.body.inn, '1655123456');
    assert.deepEqual(created.body.roles, ['customer', 'supplier']);
    const stableId = created.body.id;

    const read = await request(baseUrl, 'GET', `/api/counterparties/${stableId}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.legalName, 'ООО Ромашка');

    const updated = await request(baseUrl, 'PATCH', `/api/counterparties/${stableId}`, {
      shortName: 'Ромашка Групп',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.id, stableId);
    assert.equal(updated.body.shortName, 'Ромашка Групп');
    assert.deepEqual(updated.body.roles, ['customer', 'supplier']);
  });

  assert.equal(state.counterparties.length, 1);
});

test('Counterparty contract requires at least one explicit role', async () => {
  const app = createApp();
  await withServer(app, async baseUrl => {
    const emptyRoles = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({ roles: [] }));
    assert.equal(emptyRoles.status, 400);
    assert.equal(emptyRoles.body.code, 'COUNTERPARTY_VALIDATION_FAILED');
    assert.equal(emptyRoles.body.details.field, 'roles');

    const missingRoles = legalEntity();
    delete missingRoles.roles;
    const missing = await request(baseUrl, 'POST', '/api/counterparties', missingRoles);
    assert.equal(missing.status, 400);
    assert.equal(missing.body.code, 'COUNTERPARTY_VALIDATION_FAILED');
    assert.equal(missing.body.details.field, 'roles');
  });
});

test('Counterparty role filter follows RoleAssignment authority with legacy projection fallback only', async () => {
  const state = createState({
    counterparties: [
      { id: 'CP-active', ...legalEntity({ inn: '1655000011' }) },
      { id: 'CP-inactive', ...legalEntity({ inn: '1655000012' }) },
      { id: 'CP-legacy', ...legalEntity({ inn: '1655000013' }) },
    ],
    counterparty_role_assignments: [
      { id: 'A-active', counterpartyId: 'CP-active', roleCode: 'customer', status: 'active', validTo: null },
      { id: 'A-inactive', counterpartyId: 'CP-inactive', roleCode: 'customer', status: 'inactive', validTo: '2026-01-01' },
    ],
  });
  const app = createApp(state);
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'GET', '/api/counterparties?role=customer');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map(item => item.id), ['CP-active', 'CP-legacy']);
  });
});

test('Counterparty supports customer, supplier, contractor and deterministic multi-role sets', async () => {
  const state = createState();
  const app = createApp(state);
  await withServer(app, async baseUrl => {
    const customer = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({
      legalName: 'ООО Покупатель',
      shortName: 'Покупатель',
      inn: '1655000001',
      roles: ['customer'],
    }));
    assert.equal(customer.status, 201);
    assert.deepEqual(customer.body.roles, ['customer']);

    const supplier = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({
      legalName: 'ООО Поставщик',
      shortName: 'Поставщик',
      inn: '1655000002',
      roles: ['supplier'],
    }));
    assert.equal(supplier.status, 201);
    assert.deepEqual(supplier.body.roles, ['supplier']);

    const customerSupplier = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({
      legalName: 'ООО Две роли',
      shortName: 'Две роли',
      inn: '1655000003',
      roles: ['supplier', 'customer'],
    }));
    assert.equal(customerSupplier.status, 201);
    assert.deepEqual(customerSupplier.body.roles, ['customer', 'supplier']);

    const allRoles = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({
      legalName: 'ООО Три роли',
      shortName: 'Три роли',
      inn: '1655000004',
      roles: ['contractor', 'supplier', 'customer'],
    }));
    assert.equal(allRoles.status, 201);
    assert.deepEqual(allRoles.body.roles, ['customer', 'supplier', 'contractor']);

    const readRoles = await request(baseUrl, 'GET', `/api/counterparties/${allRoles.body.id}/roles`);
    assert.equal(readRoles.status, 200);
    assert.equal(readRoles.body.counterpartyId, allRoles.body.id);
    assert.deepEqual(readRoles.body.roles, ['customer', 'supplier', 'contractor']);
  });

  assert.equal(state.clients.length, 0, 'supplier roles must not create Client compatibility records');
});

test('role endpoints are idempotent, validate roles and never mutate identity fields', async () => {
  const state = createState();
  const app = createApp(state);
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({ roles: ['supplier'] }));
    assert.equal(created.status, 201);
    const identityBefore = {
      id: created.body.id,
      type: created.body.type,
      legalName: created.body.legalName,
      shortName: created.body.shortName,
      inn: created.body.inn,
      kpp: created.body.kpp,
      ogrn: created.body.ogrn,
      ogrnip: created.body.ogrnip,
      legalAddress: created.body.legalAddress,
      actualAddress: created.body.actualAddress,
      email: created.body.email,
      phone: created.body.phone,
      website: created.body.website,
    };

    const added = await request(baseUrl, 'POST', `/api/counterparties/${created.body.id}/roles`, {
      role: 'contractor',
    });
    assert.equal(added.status, 200);
    assert.equal(added.body.changed, true);
    assert.deepEqual(added.body.counterparty.roles, ['supplier', 'contractor']);

    const duplicate = await request(baseUrl, 'POST', `/api/counterparties/${created.body.id}/roles`, {
      role: 'contractor',
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.changed, false);
    assert.deepEqual(duplicate.body.counterparty.roles, ['supplier', 'contractor']);

    const invalid = await request(baseUrl, 'POST', `/api/counterparties/${created.body.id}/roles`, {
      role: 'carrier',
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'COUNTERPARTY_ROLE_INVALID');

    const mixedMutation = await request(baseUrl, 'POST', `/api/counterparties/${created.body.id}/roles`, {
      role: 'customer',
      legalName: 'Подмена реквизитов',
    });
    assert.equal(mixedMutation.status, 400);
    assert.equal(mixedMutation.body.code, 'COUNTERPARTY_VALIDATION_FAILED');

    const stored = state.counterparties.find(item => item.id === created.body.id);
    assert.deepEqual({
      id: stored.id,
      type: stored.type,
      legalName: stored.legalName,
      shortName: stored.shortName,
      inn: stored.inn,
      kpp: stored.kpp,
      ogrn: stored.ogrn,
      ogrnip: stored.ogrnip,
      legalAddress: stored.legalAddress,
      actualAddress: stored.actualAddress,
      email: stored.email,
      phone: stored.phone,
      website: stored.website,
    }, identityBefore);
    assert.deepEqual(stored.roles, ['supplier', 'contractor']);
  });
});

test('role mutation remains protected by backend Counterparty write authorization', async () => {
  const state = createState({
    counterparties: [{
      id: 'CP-protected',
      ...legalEntity({ roles: ['supplier'] }),
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      archivedAt: null,
    }],
  });
  const app = createApp(state, { denyWrite: true });
  await withServer(app, async baseUrl => {
    const denied = await request(baseUrl, 'POST', '/api/counterparties/CP-protected/roles', {
      role: 'contractor',
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(state.counterparties[0].roles, ['supplier']);
    assert.deepEqual(state.counterparty_role_assignments, undefined);
  });
});

test('identity PATCH preserves roles and role removal preserves identity', async () => {
  const state = createState();
  const app = createApp(state);
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({
      roles: ['customer', 'supplier', 'contractor'],
    }));
    const identityUpdated = await request(baseUrl, 'PATCH', `/api/counterparties/${created.body.id}`, {
      shortName: 'Новое короткое имя',
    });
    assert.equal(identityUpdated.status, 200);
    assert.deepEqual(identityUpdated.body.roles, ['customer', 'supplier', 'contractor']);

    const mixedPatch = await request(baseUrl, 'PATCH', `/api/counterparties/${created.body.id}`, {
      shortName: 'Запрещённое смешанное изменение',
      roles: ['supplier'],
    });
    assert.equal(mixedPatch.status, 400);
    assert.equal(mixedPatch.body.code, 'COUNTERPARTY_ROLE_MUTATION_REQUIRED');
    assert.equal(state.counterparties[0].shortName, 'Новое короткое имя');
    assert.deepEqual(state.counterparties[0].roles, ['customer', 'supplier', 'contractor']);

    const identityBeforeRoleRemoval = {
      type: identityUpdated.body.type,
      legalName: identityUpdated.body.legalName,
      shortName: identityUpdated.body.shortName,
      inn: identityUpdated.body.inn,
      kpp: identityUpdated.body.kpp,
      ogrn: identityUpdated.body.ogrn,
      ogrnip: identityUpdated.body.ogrnip,
      legalAddress: identityUpdated.body.legalAddress,
      actualAddress: identityUpdated.body.actualAddress,
      email: identityUpdated.body.email,
      phone: identityUpdated.body.phone,
      website: identityUpdated.body.website,
    };
    const removed = await request(baseUrl, 'DELETE', `/api/counterparties/${created.body.id}/roles/contractor`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.changed, true);
    assert.deepEqual(removed.body.counterparty.roles, ['customer', 'supplier']);
    assert.deepEqual({
      type: removed.body.counterparty.type,
      legalName: removed.body.counterparty.legalName,
      shortName: removed.body.counterparty.shortName,
      inn: removed.body.counterparty.inn,
      kpp: removed.body.counterparty.kpp,
      ogrn: removed.body.counterparty.ogrn,
      ogrnip: removed.body.counterparty.ogrnip,
      legalAddress: removed.body.counterparty.legalAddress,
      actualAddress: removed.body.counterparty.actualAddress,
      email: removed.body.counterparty.email,
      phone: removed.body.counterparty.phone,
      website: removed.body.counterparty.website,
    }, identityBeforeRoleRemoval);
  });
});

test('Counterparty API rejects invalid type and role with structured codes', async () => {
  const app = createApp();
  await withServer(app, async baseUrl => {
    const badType = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({ type: 'company' }));
    assert.equal(badType.status, 400);
    assert.equal(badType.body.code, 'COUNTERPARTY_VALIDATION_FAILED');
    assert.equal(badType.body.details.field, 'type');

    const badRole = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({ roles: ['carrier'] }));
    assert.equal(badRole.status, 400);
    assert.equal(badRole.body.code, 'COUNTERPARTY_ROLE_INVALID');
    assert.deepEqual(badRole.body.details.invalidRoles, ['carrier']);
  });
});

test('strong duplicate is rejected while normalized-name possible duplicate remains a distinct entity', async () => {
  const state = createState();
  const app = createApp(state);
  await withServer(app, async baseUrl => {
    const first = await request(baseUrl, 'POST', '/api/counterparties', legalEntity());
    assert.equal(first.status, 201);

    const strongDuplicate = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({
      legalName: 'ООО Другое имя',
      shortName: 'Другое',
      inn: '1655-123456',
    }));
    assert.equal(strongDuplicate.status, 409);
    assert.equal(strongDuplicate.body.code, 'COUNTERPARTY_DUPLICATE');
    assert.equal(strongDuplicate.body.details.conflicts[0].id, first.body.id);

    const possibleDuplicate = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({
      legalName: '  ооо   ромашка ',
      shortName: 'Ромашка филиал',
      inn: '7700654321',
      kpp: '770001001',
    }));
    assert.equal(possibleDuplicate.status, 201);
    assert.notEqual(possibleDuplicate.body.id, first.body.id);
    assert.equal(possibleDuplicate.body.warnings[0].code, 'COUNTERPARTY_POSSIBLE_DUPLICATE');
    assert.equal(state.counterparties.length, 2);
  });
});

test('Counterparty validation enforces type-specific registration identifiers and malformed IDs', async () => {
  const app = createApp();
  await withServer(app, async baseUrl => {
    const invalidInn = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({ inn: '12345' }));
    assert.equal(invalidInn.status, 400);
    assert.equal(invalidInn.body.code, 'COUNTERPARTY_VALIDATION_FAILED');
    assert.equal(invalidInn.body.details.field, 'inn');

    const invalidIp = await request(baseUrl, 'POST', '/api/counterparties', {
      type: 'individual_entrepreneur',
      legalName: 'ИП Тестов',
      inn: '123456789012',
      kpp: '123456789',
      roles: ['supplier'],
    });
    assert.equal(invalidIp.status, 400);
    assert.equal(invalidIp.body.details.field, 'kpp');

    const malformedId = await request(baseUrl, 'GET', '/api/counterparties/%20');
    assert.equal(malformedId.status, 400);
    assert.equal(malformedId.body.code, 'COUNTERPARTY_VALIDATION_FAILED');
  });
});

test('Counterparty update mirrors only explicitly linked Client and leaves unrelated domains untouched', async () => {
  const state = createState({
    counterparties: [{
      id: 'CP-linked',
      ...legalEntity(),
      inn: '1655123456',
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      archivedAt: null,
    }],
    clients: [
      { id: 'C-linked', counterpartyId: 'CP-linked', company: 'Ромашка', inn: '1655123456' },
      { id: 'C-name-only', company: 'ООО Ромашка', inn: '1655123456' },
    ],
    rentals: [{ id: 'R-1', clientId: 'C-linked', client: 'Историческое имя' }],
    payments: [{ id: 'P-1', clientId: 'C-linked', client: 'Историческое имя', amount: 100 }],
    documents: [{ id: 'D-1', clientId: 'C-linked', client: 'Историческое имя' }],
    service: [{ id: 'S-1', clientId: 'C-linked', client: 'Историческое имя' }],
  });
  const unrelatedBefore = structuredClone({
    rentals: state.rentals,
    payments: state.payments,
    documents: state.documents,
    service: state.service,
  });
  const app = createApp(state);

  await withServer(app, async baseUrl => {
    const updated = await request(baseUrl, 'PATCH', '/api/counterparties/CP-linked', {
      legalName: 'ООО Ромашка Новая',
      shortName: 'Ромашка Новая',
    });
    assert.equal(updated.status, 200);
  });

  assert.equal(state.clients[0].company, 'Ромашка Новая');
  assert.equal(state.clients[0].legalName, 'ООО Ромашка Новая');
  assert.equal(state.clients[1].company, 'ООО Ромашка');
  assert.equal(state.clients[1].counterpartyId, undefined);
  assert.deepEqual({
    rentals: state.rentals,
    payments: state.payments,
    documents: state.documents,
    service: state.service,
  }, unrelatedBefore);
});

test('explicit Client mapping can add customer role to the same supplier Counterparty without duplication', () => {
  const supplier = {
    id: 'CP-supplier',
    ...legalEntity({ roles: ['supplier'] }),
    inn: '1655123456',
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    archivedAt: null,
  };
  const prepared = prepareClientCompatibilityCreate({
    client: {
      id: 'C-1',
      counterpartyId: supplier.id,
      company: supplier.shortName,
      legalName: supplier.legalName,
      inn: supplier.inn,
      clientType: 'legal',
    },
    clients: [],
    counterparties: [supplier],
    generateId: () => 'CP-must-not-be-created',
    nowIso: () => '2026-08-10T12:00:00.000Z',
  });

  assert.equal(prepared.counterparties.length, 1);
  assert.equal(prepared.client.counterpartyId, supplier.id);
  assert.deepEqual(prepared.counterparties[0].roles, ['customer', 'supplier']);
});

test('Client customer notes remain profile-specific and never overwrite Counterparty notes', () => {
  const created = prepareClientCompatibilityCreate({
    client: {
      id: 'C-notes',
      company: 'ООО Профиль',
      inn: '1655123456',
      notes: 'Условия работы только для customer profile',
    },
    clients: [],
    counterparties: [],
    generateId: () => 'CP-notes',
    nowIso: () => '2026-08-10T12:00:00.000Z',
  });
  assert.equal(created.client.notes, 'Условия работы только для customer profile');
  assert.equal(created.counterparty.notes, null);

  const updated = prepareClientCompatibilityUpdate({
    previousClient: created.client,
    nextClient: { ...created.client, notes: 'Новая customer-specific заметка' },
    patch: { notes: 'Новая customer-specific заметка' },
    clients: [created.client],
    counterparties: created.counterparties,
    nowIso: () => '2026-08-11T12:00:00.000Z',
  });
  assert.equal(updated.client.notes, 'Новая customer-specific заметка');
  assert.equal(updated.counterparty.notes, null);
});

test('foundation repairs customer role for an explicitly linked Client without creating another Counterparty', () => {
  const supplier = {
    id: 'CP-explicit',
    ...legalEntity({ roles: ['supplier'] }),
    inn: '1655123456',
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    archivedAt: null,
  };
  const state = createState({
    counterparties: [supplier],
    clients: [{
      id: 'C-explicit',
      counterpartyId: supplier.id,
      company: supplier.shortName,
      legalName: supplier.legalName,
      inn: supplier.inn,
    }],
  });
  const writes = [];
  const result = ensureClientCounterpartyFoundation({
    readData: name => state[name] || [],
    writeDataBatch: entries => {
      writes.push(entries.map(entry => entry.name));
      for (const entry of entries) state[entry.name] = entry.value;
    },
    logger: { log() {}, warn() {} },
    nowIso: () => '2026-08-10T12:00:00.000Z',
  });

  assert.equal(result.created, 0);
  assert.equal(result.linked, 0);
  assert.equal(result.rolesAdded, 1);
  assert.equal(result.changed, true);
  assert.equal(state.counterparties.length, 1);
  assert.deepEqual(state.counterparties[0].roles, ['customer', 'supplier']);
  assert.equal(state.clients[0].counterpartyId, supplier.id);
  assert.deepEqual(writes, [['counterparties', 'clients']]);
});

test('customer role archives an unreferenced Client profile while the last role cannot be removed', async () => {
  const state = createState({
    counterparties: [{
      id: 'CP-role-guard',
      ...legalEntity({ roles: ['customer', 'supplier'] }),
      inn: '1655123456',
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      archivedAt: null,
    }, {
      id: 'CP-single-role',
      ...legalEntity({
        legalName: 'ООО Только поставщик',
        shortName: 'Только поставщик',
        inn: '1655000010',
        roles: ['supplier'],
      }),
      inn: '1655000010',
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      archivedAt: null,
    }],
    clients: [{ id: 'C-role-guard', counterpartyId: 'CP-role-guard' }],
  });
  const app = createApp(state);
  await withServer(app, async baseUrl => {
    const removedCustomer = await request(baseUrl, 'DELETE', '/api/counterparties/CP-role-guard/roles/customer');
    assert.equal(removedCustomer.status, 200);
    assert.equal(removedCustomer.body.changed, true);
    assert.deepEqual(state.counterparties[0].roles, ['supplier']);
    assert.equal(state.clients[0].status, 'inactive');
    assert.equal(state.clients[0].customerRoleStatus, 'inactive');
    assert.equal(state.counterparty_role_assignments.find(item => item.roleCode === 'customer').status, 'inactive');

    const blockedLastRole = await request(baseUrl, 'DELETE', '/api/counterparties/CP-single-role/roles/supplier');
    assert.equal(blockedLastRole.status, 409);
    assert.equal(blockedLastRole.body.code, 'COUNTERPARTY_ROLE_REQUIRED');
    assert.deepEqual(state.counterparties[1].roles, ['supplier']);
  });
});

test('customer role removal returns stable machine-readable blockers for durable history', async () => {
  const state = createState({
    counterparties: [{
      id: 'CP-history',
      ...legalEntity({ roles: ['customer', 'supplier'] }),
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      archivedAt: null,
    }],
    clients: [{ id: 'C-history', counterpartyId: 'CP-history', status: 'active' }],
    rentals: [{ id: 'R-history', counterpartyId: 'CP-history', clientId: 'C-history', status: 'closed' }],
    payments: [{ id: 'P-history', counterpartyId: 'CP-history', clientId: 'C-history', amount: 100 }],
  });
  const before = structuredClone(state);
  const app = createApp(state);
  await withServer(app, async baseUrl => {
    const blocked = await request(baseUrl, 'DELETE', '/api/counterparties/CP-history/roles/customer');
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'COUNTERPARTY_ROLE_REMOVAL_BLOCKED');
    assert.deepEqual(
      blocked.body.details.blockers.map(item => item.collection),
      ['rentals', 'payments'],
    );
  });
  assert.deepEqual(state, before, 'blocked removal must not persist partial migration or profile writes');
});

test('Client creation never attaches by matching name or INN', () => {
  const existing = {
    id: 'CP-existing',
    ...legalEntity({ roles: ['supplier'] }),
    inn: '1655123456',
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    archivedAt: null,
  };

  assert.throws(() => prepareClientCompatibilityCreate({
    client: { id: 'C-new', company: 'ООО Ромашка', inn: '1655123456' },
    clients: [],
    counterparties: [existing],
    generateId: () => 'CP-new',
  }), error => {
    assert.equal(error.code, 'COUNTERPARTY_DUPLICATE');
    assert.equal(error.details.conflicts[0].id, 'CP-existing');
    return true;
  });
});

test('deterministic Client migration is idempotent and never rewrites other collections', () => {
  const state = createState({
    clients: [{
      id: 'C-legacy',
      company: 'ООО Легаси',
      inn: '7700654321',
      email: 'legacy@example.test',
      phone: '+79990000000',
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
    rentals: [{ id: 'R-legacy', clientId: 'C-legacy', client: 'Снимок' }],
  });
  const writes = [];
  const readData = name => state[name] || [];
  const writeDataBatch = entries => {
    writes.push(entries.map(entry => entry.name));
    for (const entry of entries) state[entry.name] = entry.value;
  };
  const beforeRentals = structuredClone(state.rentals);

  const first = ensureClientCounterpartyFoundation({
    readData,
    writeDataBatch,
    logger: { log() {}, warn() {} },
    nowIso: () => '2026-08-10T12:00:00.000Z',
  });
  const second = ensureClientCounterpartyFoundation({
    readData,
    writeDataBatch,
    logger: { log() {}, warn() {} },
    nowIso: () => '2026-08-11T12:00:00.000Z',
  });

  const expectedId = deterministicCounterpartyId('C-legacy');
  assert.equal(first.created, 1);
  assert.equal(first.linked, 1);
  assert.equal(second.changed, false);
  assert.equal(state.counterparties.length, 1);
  assert.equal(state.counterparties[0].id, expectedId);
  assert.equal(state.clients[0].counterpartyId, expectedId);
  assert.deepEqual(state.rentals, beforeRentals);
  assert.deepEqual(writes, [['counterparties', 'clients']]);
});

test('Counterparty archive is soft-delete and refuses active Client, Site/Object, or Rental links', async () => {
  const state = createState({
    counterparties: [{
      id: 'CP-archive',
      ...legalEntity(),
      inn: '1655123456',
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      archivedAt: null,
    }],
  });
  const app = createApp(state);
  await withServer(app, async baseUrl => {
    state.clients = [{ id: 'C-1', counterpartyId: 'CP-archive' }];
    const blocked = await request(baseUrl, 'DELETE', '/api/counterparties/CP-archive');
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'COUNTERPARTY_CLIENT_LINK_CONFLICT');

    state.clients = [];
    state.client_objects = [{
      id: 'CO-1',
      counterpartyId: 'CP-archive',
      name: 'Склад',
      address: 'Казань',
      status: 'active',
    }];
    const objectBlocked = await request(baseUrl, 'DELETE', '/api/counterparties/CP-archive');
    assert.equal(objectBlocked.status, 409);
    assert.equal(objectBlocked.body.code, 'COUNTERPARTY_DOMAIN_LINK_CONFLICT');
    assert.deepEqual(objectBlocked.body.details.clientObjectIds, ['CO-1']);

    state.client_objects[0].status = 'archived';
    state.rentals = [{
      id: 'R-active-direct',
      counterpartyId: 'CP-archive',
      status: 'active',
    }];
    const rentalBlocked = await request(baseUrl, 'DELETE', '/api/counterparties/CP-archive');
    assert.equal(rentalBlocked.status, 409);
    assert.equal(rentalBlocked.body.code, 'COUNTERPARTY_DOMAIN_LINK_CONFLICT');
    assert.deepEqual(rentalBlocked.body.details.rentalIds, ['R-active-direct']);

    state.rentals[0].status = 'closed';
    state.deliveries = [{ id: 'D-active', counterpartyId: 'CP-archive', status: 'in_transit' }];
    const deliveryBlocked = await request(baseUrl, 'DELETE', '/api/counterparties/CP-archive');
    assert.equal(deliveryBlocked.status, 409);
    assert.deepEqual(deliveryBlocked.body.details.deliveryIds, ['D-active']);

    state.deliveries[0].status = 'completed';
    state.service = [{ id: 'S-active', counterpartyId: 'CP-archive', status: 'waiting_parts' }];
    const serviceBlocked = await request(baseUrl, 'DELETE', '/api/counterparties/CP-archive');
    assert.equal(serviceBlocked.status, 409);
    assert.deepEqual(serviceBlocked.body.details.serviceTicketIds, ['S-active']);

    state.service[0].status = 'ready';
    state.delivery_carriers = [{ id: 'DC-active', counterpartyId: 'CP-archive', status: 'active' }];
    const carrierBlocked = await request(baseUrl, 'DELETE', '/api/counterparties/CP-archive');
    assert.equal(carrierBlocked.status, 409);
    assert.deepEqual(carrierBlocked.body.details.deliveryCarrierIds, ['DC-active']);

    state.delivery_carriers[0].status = 'inactive';
    const archived = await request(baseUrl, 'DELETE', '/api/counterparties/CP-archive');
    assert.equal(archived.status, 200);
    assert.equal(archived.body.counterparty.status, 'archived');
    assert.equal(archived.body.counterparty.archivedAt, '2026-08-10T12:00:00.000Z');

    const activeList = await request(baseUrl, 'GET', '/api/counterparties');
    assert.deepEqual(activeList.body, []);
    const allList = await request(baseUrl, 'GET', '/api/counterparties?includeArchived=1');
    assert.equal(allList.body.length, 1);
  });
});

test('Counterparty archive deactivates role assignments and profiles without deleting them', async () => {
  const state = createState();
  const app = createApp(state);
  await withServer(app, async baseUrl => {
    const created = await request(baseUrl, 'POST', '/api/counterparties', legalEntity({ roles: ['supplier'] }));
    assert.equal(created.status, 201);
    const profileId = state.supplier_profiles[0].id;

    const archived = await request(baseUrl, 'DELETE', `/api/counterparties/${created.body.id}`);
    assert.equal(archived.status, 200);
    assert.equal(state.counterparty_role_assignments[0].status, 'inactive');
    assert.equal(state.counterparty_role_assignments[0].validTo, '2026-08-10T12:00:00.000Z');
    assert.equal(state.supplier_profiles[0].id, profileId);
    assert.equal(state.supplier_profiles[0].status, 'inactive');
  });
});
