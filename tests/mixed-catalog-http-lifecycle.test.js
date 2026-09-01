import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import {
  createPlatformIdentityContext,
  seedAuthority,
  testActor,
} from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createAccessControl } = require('../server/lib/access-control.js');
const {
  createTenantDataBoundary,
  runWithTenantActorScope,
} = require('../server/lib/tenant-data-boundary.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');

const MIXED_CATALOGS = Object.freeze([
  'knowledge_base_modules',
  'service_works',
  'spare_parts',
  'service_route_norms',
  'service_work_catalog',
  'spare_parts_catalog',
  'service_work_names',
  'spare_part_names',
]);
const SCOPE_A = Object.freeze({
  companyId: 'COMPANY-A',
  tenantId: 'COMPANY-A',
  membershipId: 'MEMBERSHIP-COMPANY-A',
  principalId: 'U-A',
  source: 'mixed-catalog-http-test',
});
const SCOPE_B = Object.freeze({
  companyId: 'COMPANY-B',
  tenantId: 'COMPANY-B',
  membershipId: 'MEMBERSHIP-COMPANY-B',
  principalId: 'U-B',
  source: 'mixed-catalog-http-test',
});

function scoped(scope, record) {
  return {
    ...record,
    companyId: scope.companyId,
    tenantId: scope.tenantId,
  };
}

function defaultId(collection) {
  return `${collection}-DEFAULT`;
}

function platformDefault(collection, overrides = {}) {
  return {
    id: defaultId(collection),
    name: `${collection} platform value`,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

function tenantOverride(collection, scope, physicalId, overrides = {}) {
  return scoped(scope, {
    id: physicalId,
    platformDefaultId: defaultId(collection),
    name: `${collection} ${scope.companyId} override`,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  });
}

function normalizeServiceWorkRecord(record) {
  return {
    ...record,
    name: String(record?.name || '').trim(),
    isActive: record?.isActive !== false,
    sortOrder: Number.isFinite(Number(record?.sortOrder)) ? Number(record.sortOrder) : 0,
  };
}

function normalizeSparePartRecord(record) {
  return {
    ...record,
    name: String(record?.name || '').trim(),
    unit: String(record?.unit || 'шт').trim() || 'шт',
    isActive: record?.isActive !== false,
  };
}

function seedTenantAuthority(context, scope) {
  seedAuthority(context, {
    companyId: scope.companyId,
    branches: [{
      id: `BRANCH-${scope.companyId}`,
      displayName: `Head ${scope.companyId}`,
      isHeadOffice: true,
    }],
    templateKey: `TEMPLATE-${scope.companyId}`,
    templateCapabilities: [],
  });
  context.repository.createMembership({
    id: scope.membershipId,
    companyId: scope.companyId,
    principalId: scope.principalId,
    status: 'active',
    roleTemplateKey: `TEMPLATE-${scope.companyId}`,
    roleTemplateVersion: 1,
    companyWideBranchAuthority: true,
    branchIds: [],
    actorContext: testActor(),
    reason: 'mixed-catalog-http-test',
  });
}

function createHarnessState(initialCollections = {}) {
  const state = { audit_logs: [] };
  for (const collection of MIXED_CATALOGS) state[collection] = [];
  for (const [collection, records] of Object.entries(initialCollections)) {
    state[collection] = structuredClone(records);
  }
  return state;
}

async function createHarness(initialCollections = {}) {
  const identity = createPlatformIdentityContext({
    users: [
      { id: 'U-admin', name: 'Platform bootstrap actor', role: 'Администратор', status: 'Активен' },
      { id: 'U-A', name: 'Admin A', role: 'Администратор', status: 'Активен' },
      { id: 'U-B', name: 'Admin B', role: 'Администратор', status: 'Активен' },
    ],
  });
  seedTenantAuthority(identity, SCOPE_A);
  seedTenantAuthority(identity, SCOPE_B);

  const state = createHarnessState(initialCollections);
  const readRawData = collection => (
    Object.prototype.hasOwnProperty.call(state, collection) ? state[collection] : null
  );
  const writeRawData = (collection, value) => {
    state[collection] = structuredClone(value);
  };
  const writeRawDataBatch = entries => {
    const next = structuredClone(state);
    for (const entry of entries) next[entry.name] = structuredClone(entry.value);
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, next);
  };
  let catalogIdSequence = 0;
  let mutationAuditSequence = 0;
  const boundary = createTenantDataBoundary({
    db: identity.db,
    readRawData,
    writeRawData,
    writeRawDataBatch,
    generateCatalogRecordId: (prefix, { collection }) => (
      `${prefix}-${collection}-${++catalogIdSequence}`
    ),
    generateMutationAuditId: () => `AUD-MUT-${++mutationAuditSequence}`,
    nowIso: () => '2026-08-31T12:00:00.000Z',
  });
  const accessControl = createAccessControl({ readData: boundary.readData });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const scope = req.get('x-test-tenant') === 'B' ? SCOPE_B : SCOPE_A;
    req.actorScope = scope;
    req.user = {
      userId: scope.principalId,
      userName: `Admin ${scope.companyId}`,
      userRole: 'Администратор',
      companyId: scope.companyId,
      tenantId: scope.tenantId,
    };
    return runWithTenantActorScope(scope, next);
  });
  const allow = () => (_req, _res, next) => next();
  app.use('/api', registerCrudRoutes({
    collections: MIXED_CATALOGS,
    idPrefixes: Object.fromEntries(MIXED_CATALOGS.map(collection => [collection, collection])),
    readData: boundary.readData,
    writeData: boundary.writeData,
    writeDataBatch: boundary.writeDataBatch,
    requireAuth: (_req, _res, next) => next(),
    requireRead: allow,
    requireWrite: allow,
    sanitizeUser: value => value,
    publicUserView: value => value,
    canReadFullUsers: () => true,
    hashPassword: value => value,
    normalizeServiceWorkRecord,
    normalizeSparePartRecord,
    validateRentalPayload: () => ({ ok: true }),
    mergeEntityHistory: (_collection, _previous, next) => next,
    requireNonEmptyString(value, label) {
      if (!String(value || '').trim()) throw new Error(`${label} is required`);
    },
    generateId: prefix => `${prefix}-generic-id`,
    nowIso: () => '2026-08-31T12:00:00.000Z',
    accessControl,
    auditLog: () => {},
    serviceAuditLog: () => {},
    normalizeRecordClientLink: value => value,
    catalogLifecycle: boundary,
    db: identity.db,
  }));
  app.use((error, _req, res, _next) => res.status(error?.status || 500).json({
    ok: false,
    ...(error?.code ? { code: error.code } : {}),
    error: error?.message || 'Unhandled request error',
  }));

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    boundary,
    state,
    async request(method, route, { tenant = 'A', body } = {}) {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-test-tenant': tenant,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const responseBody = await response.json();
      return { status: response.status, body: responseBody };
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
      identity.close();
    },
  };
}

async function withHarness(initialCollections, operation) {
  const harness = await createHarness(initialCollections);
  try {
    return await operation(harness);
  } finally {
    await harness.close();
  }
}

test('1. GET exposes every platform default under its stable logical/default ID', async () => {
  const initial = Object.fromEntries(MIXED_CATALOGS.map(collection => [
    collection,
    [platformDefault(collection)],
  ]));
  await withHarness(initial, async ({ request }) => {
    for (const collection of MIXED_CATALOGS) {
      const response = await request('GET', `/api/${collection}`);
      assert.equal(response.status, 200, collection);
      assert.equal(response.body.length, 1, collection);
      assert.equal(response.body[0].id, defaultId(collection), collection);
      assert.equal(response.body[0].catalogOrigin.kind, 'platform_default', collection);
      assert.equal(response.body[0].catalogOrigin.logicalId, defaultId(collection), collection);
      assert.equal(response.body[0].catalogOrigin.tenantMutable, false, collection);
    }
  });
});

test('2. GET projects tenant override values under the platform default logical ID', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [
      platformDefault(collection, { name: 'Platform work' }),
      tenantOverride(collection, SCOPE_A, 'OVR-A-PHYSICAL', { name: 'Company A work' }),
    ],
  }, async ({ request }) => {
    const response = await request('GET', `/api/${collection}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map(item => item.id), [defaultId(collection)]);
    assert.equal(response.body[0].name, 'Company A work');
    assert.equal(response.body[0].catalogOrigin.kind, 'tenant_override');
    assert.equal(response.body[0].catalogOrigin.platformDefaultId, defaultId(collection));
    assert.equal(JSON.stringify(response.body).includes('OVR-A-PHYSICAL'), false);
  });
});

test('3. Tenant A override is invisible to Tenant B', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [
      platformDefault(collection, { name: 'Platform work' }),
      tenantOverride(collection, SCOPE_A, 'OVR-A-PHYSICAL', { name: 'Company A work' }),
    ],
  }, async ({ request }) => {
    const response = await request('GET', `/api/${collection}`, { tenant: 'B' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map(item => item.id), [defaultId(collection)]);
    assert.equal(response.body[0].name, 'Platform work');
    assert.equal(response.body[0].catalogOrigin.kind, 'platform_default');
  });
});

test('4. POST creates a standalone tenant row with a unique physical ID and exact scope', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [platformDefault(collection)],
  }, async ({ request, state }) => {
    const response = await request('POST', `/api/${collection}`, {
      body: { name: 'Tenant-only work', sortOrder: 7 },
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.catalogOrigin.kind, 'tenant_entry');
    assert.match(response.body.id, /^TEN-service_works-/);
    assert.notEqual(response.body.id, defaultId(collection));

    const stored = state[collection].find(item => item.id === response.body.id);
    assert.ok(stored);
    assert.equal(stored.companyId, SCOPE_A.companyId);
    assert.equal(stored.tenantId, SCOPE_A.tenantId);
    assert.equal(Object.hasOwn(stored, 'platformDefaultId'), false);
  });
});

test('5. PATCH of a logical default creates one tenant-scoped physical override', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [
      platformDefault(collection, { name: 'Platform work' }),
      tenantOverride(collection, SCOPE_B, 'OVR-B-PHYSICAL', { name: 'Company B work' }),
    ],
  }, async ({ request, state }) => {
    const response = await request('PATCH', `/api/${collection}/${defaultId(collection)}`, {
      body: { name: 'Company A override' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.id, defaultId(collection));
    assert.equal(response.body.name, 'Company A override');
    assert.equal(response.body.catalogOrigin.kind, 'tenant_override');

    const ownOverrides = state[collection].filter(item => (
      item.companyId === SCOPE_A.companyId
      && item.platformDefaultId === defaultId(collection)
      && item.isActive !== false
    ));
    assert.equal(ownOverrides.length, 1);
    assert.match(ownOverrides[0].id, /^OVR-service_works-/);
    assert.notEqual(ownOverrides[0].id, defaultId(collection));
    assert.notEqual(ownOverrides[0].id, 'OVR-B-PHYSICAL');
    assert.equal(ownOverrides[0].tenantId, SCOPE_A.tenantId);
    assert.equal(ownOverrides[0].platformDefaultId, defaultId(collection));
  });
});

test('6. Repeated PATCH through the logical ID updates only the existing tenant override', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [
      platformDefault(collection, { name: 'Platform work', description: 'Platform description' }),
      tenantOverride(collection, SCOPE_A, 'OVR-A-PHYSICAL', {
        name: 'Company A work',
        description: 'Company A description',
      }),
    ],
  }, async ({ request, state }) => {
    const response = await request('PATCH', `/api/${collection}/${defaultId(collection)}`, {
      body: { description: 'Company A revised' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.id, defaultId(collection));
    assert.equal(response.body.description, 'Company A revised');

    const rawDefault = state[collection].find(item => item.id === defaultId(collection));
    const rawOverrides = state[collection].filter(item => (
      item.companyId === SCOPE_A.companyId
      && item.platformDefaultId === defaultId(collection)
      && item.isActive !== false
    ));
    assert.equal(rawDefault.description, 'Platform description');
    assert.equal(rawOverrides.length, 1);
    assert.equal(rawOverrides[0].id, 'OVR-A-PHYSICAL');
    assert.equal(rawOverrides[0].description, 'Company A revised');

    const tenantB = await request('GET', `/api/${collection}`, { tenant: 'B' });
    assert.equal(tenantB.body[0].description, 'Platform description');
  });
});

test('7. DELETE cannot remove a platform default and deleting an override falls back to it', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [platformDefault(collection, { name: 'Platform work' })],
  }, async ({ request, state }) => {
    const denied = await request('DELETE', `/api/${collection}/${defaultId(collection)}`);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'CATALOG_PLATFORM_DEFAULT_MUTATION_DENIED');
    assert.equal(state[collection].length, 1);
    assert.equal(state[collection][0].name, 'Platform work');

    const overridden = await request('PATCH', `/api/${collection}/${defaultId(collection)}`, {
      body: { name: 'Company A override' },
    });
    assert.equal(overridden.status, 200);
    const removedOverride = await request('DELETE', `/api/${collection}/${defaultId(collection)}`);
    assert.equal(removedOverride.status, 200);
    assert.equal(removedOverride.body.ok, true);
    assert.equal(removedOverride.body.effective.id, defaultId(collection));
    assert.equal(removedOverride.body.effective.name, 'Platform work');
    assert.equal(removedOverride.body.effective.catalogOrigin.kind, 'platform_default');
    assert.equal(state[collection].some(item => item.platformDefaultId === defaultId(collection)), false);
    assert.equal(state[collection].some(item => item.id === defaultId(collection)), true);
  });
});

test('8. A physical override ID cannot bypass the public logical-ID contract', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [
      platformDefault(collection),
      tenantOverride(collection, SCOPE_A, 'OVR-A-PHYSICAL'),
    ],
  }, async ({ request, state }) => {
    const before = structuredClone(state[collection]);
    assert.equal((await request('GET', `/api/${collection}/OVR-A-PHYSICAL`)).status, 404);
    assert.equal((await request('PATCH', `/api/${collection}/OVR-A-PHYSICAL`, {
      body: { name: 'Physical ID attack' },
    })).status, 404);
    assert.equal((await request('DELETE', `/api/${collection}/OVR-A-PHYSICAL`)).status, 404);
    assert.deepEqual(state[collection], before);
  });
});

test('9. Another tenant cannot access or mutate a foreign physical override ID', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [
      platformDefault(collection),
      tenantOverride(collection, SCOPE_A, 'OVR-A-PHYSICAL'),
    ],
  }, async ({ request, state }) => {
    const before = structuredClone(state[collection]);
    assert.equal((await request('GET', `/api/${collection}/OVR-A-PHYSICAL`, { tenant: 'B' })).status, 404);
    assert.equal((await request('PATCH', `/api/${collection}/OVR-A-PHYSICAL`, {
      tenant: 'B',
      body: { name: 'Tenant B attack' },
    })).status, 404);
    assert.equal((await request('DELETE', `/api/${collection}/OVR-A-PHYSICAL`, {
      tenant: 'B',
    })).status, 404);
    assert.deepEqual(state[collection], before);
  });
});

test('10. Duplicate active overrides fail closed before an HTTP mutation', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [
      platformDefault(collection),
      tenantOverride(collection, SCOPE_A, 'OVR-A-ONE'),
      tenantOverride(collection, SCOPE_A, 'OVR-A-TWO'),
    ],
  }, async ({ request, state }) => {
    const before = structuredClone(state[collection]);
    const response = await request('PATCH', `/api/${collection}/${defaultId(collection)}`, {
      body: { name: 'Must not persist' },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'CATALOG_ACTIVE_OVERRIDE_DUPLICATE');
    assert.deepEqual(state[collection], before);
  });
});

test('11. Invalid or client-supplied platformDefaultId is denied fail closed', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [platformDefault(collection)],
  }, async ({ request, state }) => {
    const before = structuredClone(state[collection]);
    for (const [method, route, body] of [
      ['POST', `/api/${collection}`, { name: 'Forged override', platformDefaultId: 'MISSING' }],
      ['PATCH', `/api/${collection}/${defaultId(collection)}`, {
        name: 'Forged override',
        platformDefaultId: 'MISSING',
      }],
    ]) {
      const response = await request(method, route, { body });
      assert.equal(response.status, 409, method);
      assert.equal(response.body.code, 'CATALOG_CLIENT_RESERVED_FIELD_DENIED', method);
    }
    assert.deepEqual(state[collection], before);

    state[collection] = [
      platformDefault(collection),
      scoped(SCOPE_A, {
        id: 'OVR-A-DANGLING',
        platformDefaultId: 'MISSING',
        name: 'Dangling persisted override',
      }),
    ];
    const dangling = await request('PATCH', `/api/${collection}/${defaultId(collection)}`, {
      body: { name: 'Must fail before mutation' },
    });
    assert.equal(dangling.status, 409);
    assert.equal(dangling.body.code, 'CATALOG_OVERRIDE_DEFAULT_NOT_FOUND');
  });
});

test('12. Standalone tenant entries remain independent from overlay resolution', async () => {
  const collection = 'service_works';
  await withHarness({
    [collection]: [
      platformDefault(collection, { name: 'Platform work' }),
      scoped(SCOPE_A, {
        id: 'TEN-A-STANDALONE',
        name: 'Standalone A',
        isActive: true,
        sortOrder: 1,
      }),
    ],
  }, async ({ request, state }) => {
    const patchedStandalone = await request('PATCH', `/api/${collection}/TEN-A-STANDALONE`, {
      body: { name: 'Standalone A revised' },
    });
    assert.equal(patchedStandalone.status, 200);
    assert.equal(patchedStandalone.body.id, 'TEN-A-STANDALONE');
    assert.equal(patchedStandalone.body.catalogOrigin.kind, 'tenant_entry');

    assert.equal((await request('PATCH', `/api/${collection}/${defaultId(collection)}`, {
      body: { name: 'Company A override' },
    })).status, 200);
    assert.equal((await request('DELETE', `/api/${collection}/${defaultId(collection)}`)).status, 200);

    const response = await request('GET', `/api/${collection}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map(item => item.id).sort(), [
      'TEN-A-STANDALONE',
      defaultId(collection),
    ].sort());
    assert.equal(response.body.find(item => item.id === defaultId(collection)).name, 'Platform work');
    assert.equal(response.body.find(item => item.id === 'TEN-A-STANDALONE').name, 'Standalone A revised');

    const rawStandalone = state[collection].find(item => item.id === 'TEN-A-STANDALONE');
    assert.equal(Object.hasOwn(rawStandalone, 'platformDefaultId'), false);
    assert.equal(rawStandalone.companyId, SCOPE_A.companyId);
    assert.equal(rawStandalone.tenantId, SCOPE_A.tenantId);
  });
});
