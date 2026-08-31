import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import {
  seedAuthority,
  testActor,
} from './platform-identity-fixtures.js';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  createPlatformIdentityRepository,
} = serverRequire('./lib/platform-identity-repository.js');
const {
  syncSqlShadowIndexForCollection,
} = serverRequire('./lib/sql-shadow-indexes.js');
const SERVER_DIR = path.resolve('server');
const SERVER_ENTRY = path.join(SERVER_DIR, 'server.js');
const TEST_PASSWORD = 'trusted-scope-e2e-password';

function legacyPasswordHash(password) {
  return `h1:${crypto.createHash('sha256').update(`${password}:rental-mgmt-v1`).digest('hex')}`;
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function testServerEnv({ dbPath, port }) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DB_PATH: dbPath,
    BOT_DISABLED: 'true',
    GSM_DISABLED: 'true',
    GPRS_ENABLED: 'false',
    MAX_BOT_TRANSPORT: 'disabled',
    LOGIN_FAILURE_DELAY_MS: '0',
    USE_SQL_DOCUMENTS_INDEX: 'true',
    USE_SQL_GANTT_INDEX: 'true',
  };
  for (const name of [
    'ADMIN_RESET_EMAIL',
    'ADMIN_RESET_PASSWORD',
    'BOOTSTRAP_ADMIN_EMAIL',
    'BOOTSTRAP_ADMIN_PASSWORD',
    'DEV_SEED_PASSWORD',
  ]) delete env[name];
  return env;
}

async function startActualServer(dbPath) {
  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: testServerEnv({ dbPath, port }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = chunk => {
    output = `${output}${String(chunk)}`.slice(-20_000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Actual server exited during startup (${child.exitCode}).\n${output}`);
    }
    try {
      const health = await fetch(`${baseUrl}/health`);
      if (health.ok) return { baseUrl, child, getOutput: () => output };
    } catch {
      // The listener is not ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill('SIGKILL');
  throw new Error(`Actual server did not become healthy.\n${output}`);
}

async function stopActualServer(server) {
  if (!server || server.child.exitCode !== null) return;
  const exited = new Promise(resolve => server.child.once('exit', resolve));
  server.child.kill('SIGTERM');
  const timer = setTimeout(() => server.child.kill('SIGKILL'), 5_000);
  await exited;
  clearTimeout(timer);
}

async function api(baseUrl, method, route, { token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

function readDatabaseState(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const readCollection = name => {
      const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
      return row ? JSON.parse(row.json) : [];
    };
    return {
      counterparties: readCollection('counterparties'),
      assignments: readCollection('counterparty_role_assignments'),
      supplierProfiles: readCollection('supplier_profiles'),
      contractorProfiles: readCollection('contractor_profiles'),
      clients: readCollection('clients'),
      clientObjects: readCollection('client_objects'),
      clientContracts: readCollection('client_contracts'),
      auditLogs: readCollection('audit_logs'),
    };
  } finally {
    db.close();
  }
}

test('real server preserves trusted actor scope and passes create-role-archive lifecycle after restart', {
  timeout: 45_000,
}, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-trusted-scope-e2e-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const users = [
    {
      id: 'U-admin',
      name: 'Identity Provisioner',
      email: 'identity-provisioner@example.test',
      role: 'Администратор',
      status: 'Активен',
      password: legacyPasswordHash(TEST_PASSWORD),
      tokenVersion: 0,
    },
    {
      id: 'U-scoped-admin',
      name: 'Scoped Admin',
      email: 'scoped-admin@example.test',
      role: 'Администратор',
      status: 'Активен',
      password: legacyPasswordHash(TEST_PASSWORD),
      companyId: 'forged-user-company',
      tenantId: 'forged-user-tenant',
      tokenVersion: 0,
    },
    {
      id: 'U-unscoped-admin',
      name: 'Unscoped Admin',
      email: 'unscoped-admin@example.test',
      role: 'Администратор',
      status: 'Активен',
      password: legacyPasswordHash(TEST_PASSWORD),
      tokenVersion: 0,
    },
    {
      id: 'U-company-b-admin',
      name: 'Company B Admin',
      email: 'company-b-admin@example.test',
      role: 'Администратор',
      status: 'Активен',
      password: legacyPasswordHash(TEST_PASSWORD),
      tokenVersion: 0,
    },
    {
      id: 'U-ambiguous-admin',
      name: 'Ambiguous Admin',
      email: 'ambiguous-admin@example.test',
      role: 'Администратор',
      status: 'Активен',
      password: legacyPasswordHash(TEST_PASSWORD),
      tokenVersion: 0,
    },
    {
      id: 'U-inactive-company-admin',
      name: 'Inactive Company Admin',
      email: 'inactive-company-admin@example.test',
      role: 'Администратор',
      status: 'Активен',
      password: legacyPasswordHash(TEST_PASSWORD),
      tokenVersion: 0,
    },
  ];

  let server;
  server = await startActualServer(dbPath);
  await stopActualServer(server);
  server = null;

  const identityDb = new Database(dbPath);
  identityDb.pragma('foreign_keys = ON');
  identityDb.prepare(`
    INSERT INTO app_data (name, json, updated_at)
    VALUES ('users', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = CURRENT_TIMESTAMP
  `).run(JSON.stringify(users));
  const readUsers = () => JSON.parse(
    identityDb.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json,
  );
  let identitySequence = 0;
  const identity = {
    db: identityDb,
    readUsers,
    repository: createPlatformIdentityRepository(identityDb, {
      readUsers,
      nowIso: () => `2026-08-24T00:00:${String(identitySequence++).padStart(2, '0')}.000Z`,
      generateId: prefix => `${prefix}-${++identitySequence}`,
    }),
  };
  try {
    seedAuthority(identity, {
      companyId: 'company-a',
      branches: [{ id: 'branch-company-a', displayName: 'Head Office', isHeadOffice: true }],
      templateKey: 'template-a',
      templateCapabilities: [],
    });
    seedAuthority(identity, {
      companyId: 'company-b',
      branches: [{ id: 'branch-company-b', displayName: 'Head Office B', isHeadOffice: true }],
      templateKey: 'template-b',
      templateCapabilities: [],
    });
    seedAuthority(identity, {
      companyId: 'company-inactive',
      branches: [{ id: 'branch-company-inactive', displayName: 'Head Office inactive', isHeadOffice: true }],
      templateKey: 'template-inactive',
      templateCapabilities: [],
    });
    identity.repository.createMembership({
      id: 'membership-scoped-admin',
      companyId: 'company-a',
      principalId: 'U-scoped-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: true,
      branchIds: [],
      actorContext: testActor(),
      reason: 'server-e2e-membership',
    });
    identity.repository.createMembership({
      id: 'membership-company-b-admin',
      companyId: 'company-b',
      principalId: 'U-company-b-admin',
      status: 'active',
      roleTemplateKey: 'template-b',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: true,
      branchIds: [],
      actorContext: testActor(),
      reason: 'server-e2e-membership',
    });
    const insertMembershipFixture = identity.db.prepare(`
      INSERT INTO company_memberships (
        id, companyId, principalId, status, roleTemplateKey, roleTemplateVersion,
        companyWideBranchAuthority, version, createdAt, updatedAt, activatedAt,
        createdBy, updatedBy, reason
      ) VALUES (?, ?, ?, 'active', ?, 1, 1, 1, ?, ?, ?, 'test-fixture', 'test-fixture', ?)
    `);
    for (const [id, companyId, principalId, roleTemplateKey] of [
      ['membership-ambiguous-a', 'company-a', 'U-ambiguous-admin', 'template-a'],
      ['membership-ambiguous-b', 'company-b', 'U-ambiguous-admin', 'template-b'],
      ['membership-inactive', 'company-inactive', 'U-inactive-company-admin', 'template-inactive'],
    ]) {
      insertMembershipFixture.run(
        id,
        companyId,
        principalId,
        roleTemplateKey,
        '2026-08-24T00:10:00.000Z',
        '2026-08-24T00:10:00.000Z',
        '2026-08-24T00:10:00.000Z',
        'server-e2e-negative-membership',
      );
    }
    identity.db.prepare(`
      UPDATE canonical_companies
      SET status = 'inactive', version = version + 1, updatedAt = ?
      WHERE id = 'company-inactive'
    `).run('2026-08-24T01:00:00.000Z');
    const scopedFixtures = {
      counterparties: [
        { id: 'CP-A', legalName: 'Company A client', status: 'active', roles: ['customer'], companyId: 'company-a', tenantId: 'company-a' },
        { id: 'CP-B', legalName: 'Company B client', status: 'active', roles: ['customer'], companyId: 'company-b', tenantId: 'company-b' },
      ],
      counterparty_role_assignments: [
        { id: 'CPRA-A', counterpartyId: 'CP-A', roleCode: 'customer', status: 'active', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'CPRA-B', counterpartyId: 'CP-B', roleCode: 'customer', status: 'active', companyId: 'company-b', tenantId: 'company-b' },
      ],
      clients: [
        { id: 'C-A', company: 'Company A client', inn: '7707083893', innNormalized: '7707083893', counterpartyId: 'CP-A', status: 'active', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'C-B', company: 'Company B client', inn: '7811111111', innNormalized: '7811111111', counterpartyId: 'CP-B', status: 'active', companyId: 'company-b', tenantId: 'company-b' },
      ],
      equipment: [
        { id: 'EQ-A', inventoryNumber: 'A-001', manufacturer: 'Visible A', model: 'Lift A', status: 'available', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'EQ-B', inventoryNumber: 'B-SECRET', manufacturer: 'Confidential B', model: 'Lift B', status: 'available', companyId: 'company-b', tenantId: 'company-b' },
      ],
      rentals: [
        { id: 'R-A', clientId: 'C-A', equipmentId: 'EQ-A', status: 'active', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'R-B', clientId: 'C-B', equipmentId: 'EQ-B', status: 'active', companyId: 'company-b', tenantId: 'company-b' },
      ],
      gantt_rentals: [
        { id: 'GR-A', rentalId: 'R-A', clientId: 'C-A', equipmentId: 'EQ-A', client: 'Company A client', startDate: '2026-08-01', endDate: '2026-09-01', status: 'active', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'GR-B', rentalId: 'R-B', clientId: 'C-B', equipmentId: 'EQ-B', client: 'SQL Gantt B Secret', startDate: '2026-08-01', endDate: '2026-09-01', status: 'active', companyId: 'company-b', tenantId: 'company-b' },
      ],
      documents: [
        { id: 'DOC-A', type: 'act', number: 'ACT-A', clientId: 'C-A', rentalId: 'R-A', date: '2026-08-20', status: 'signed', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'DOC-B', type: 'act', number: 'SQL-DOCUMENT-B-SECRET', clientId: 'C-B', rentalId: 'R-B', date: '2026-08-20', status: 'signed', companyId: 'company-b', tenantId: 'company-b' },
      ],
      app_settings: [
        { id: 'SETTING-A', key: 'tenant_label', value: 'A', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'SETTING-B', key: 'tenant_label', value: 'B-secret', companyId: 'company-b', tenantId: 'company-b' },
      ],
      knowledge_base_modules: [
        { id: 'KB-A', title: 'Company A training', section: 'manager_training', audience: 'all', isActive: true, quiz: [], companyId: 'company-a', tenantId: 'company-a' },
        { id: 'KB-B', title: 'Company B confidential training', section: 'manager_training', audience: 'all', isActive: true, quiz: [], companyId: 'company-b', tenantId: 'company-b' },
        { id: 'KB-LEGACY', title: 'Legacy unscoped training', section: 'manager_training', audience: 'all', isActive: true, quiz: [] },
      ],
      service_works: [
        { id: 'SW-A', name: 'Company A labour rate', normHours: 1, ratePerHour: 2500, isActive: true, companyId: 'company-a', tenantId: 'company-a' },
        { id: 'SW-B', name: 'Company B confidential labour rate', normHours: 2, ratePerHour: 9000, isActive: true, companyId: 'company-b', tenantId: 'company-b' },
        { id: 'SW-LEGACY', name: 'Legacy unscoped work', normHours: 1, ratePerHour: 1, isActive: true },
      ],
      spare_parts: [
        { id: 'PART-A', name: 'Company A part', article: 'A-1', unit: 'шт', defaultPrice: 1000, isActive: true, companyId: 'company-a', tenantId: 'company-a' },
        { id: 'PART-B', name: 'Company B confidential part', article: 'B-SECRET', unit: 'шт', defaultPrice: 99000, isActive: true, companyId: 'company-b', tenantId: 'company-b' },
        { id: 'PART-LEGACY', name: 'Legacy unscoped part', article: 'LEGACY', unit: 'шт', defaultPrice: 1, isActive: true },
      ],
      service_route_norms: [
        { id: 'ROUTE-A', from: 'A depot', to: 'A site', distanceKm: 10, companyId: 'company-a', tenantId: 'company-a' },
        { id: 'ROUTE-B', from: 'B confidential depot', to: 'B site', distanceKm: 20, companyId: 'company-b', tenantId: 'company-b' },
      ],
      service_work_catalog: [
        { id: 'SWC-A', name: 'Company A legacy work', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'SWC-B', name: 'Company B confidential legacy work', companyId: 'company-b', tenantId: 'company-b' },
      ],
      spare_parts_catalog: [
        { id: 'SPC-A', name: 'Company A legacy part', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'SPC-B', name: 'Company B confidential legacy part', companyId: 'company-b', tenantId: 'company-b' },
      ],
      service_work_names: [
        { id: 'SWN-A', name: 'Company A work name', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'SWN-B', name: 'Company B confidential work name', companyId: 'company-b', tenantId: 'company-b' },
      ],
      spare_part_names: [
        { id: 'SPN-A', name: 'Company A part name', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'SPN-B', name: 'Company B confidential part name', companyId: 'company-b', tenantId: 'company-b' },
      ],
      audit_logs: [
        { id: 'AUDIT-A', action: 'equipment.read', entityType: 'equipment', createdAt: '2026-08-24T00:00:00.000Z', companyId: 'company-a', tenantId: 'company-a' },
        { id: 'AUDIT-B', action: 'equipment.secret', entityType: 'equipment', createdAt: '2026-08-24T00:00:00.000Z', companyId: 'company-b', tenantId: 'company-b' },
      ],
    };
    const writeFixture = identity.db.prepare(`
      INSERT INTO app_data (name, json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = CURRENT_TIMESTAMP
    `);
    for (const [name, value] of Object.entries(scopedFixtures)) {
      writeFixture.run(name, JSON.stringify(value));
    }
    syncSqlShadowIndexForCollection(identityDb, 'documents', scopedFixtures.documents);
    syncSqlShadowIndexForCollection(identityDb, 'gantt_rentals', scopedFixtures.gantt_rentals);
  } finally {
    identity.db.close();
  }

  try {
    server = await startActualServer(dbPath);
    const login = await api(server.baseUrl, 'POST', '/api/auth/login', {
      headers: {
        'x-company-id': 'forged-header-company',
        'x-tenant-id': 'forged-header-tenant',
      },
      body: {
        email: 'scoped-admin@example.test',
        password: TEST_PASSWORD,
        companyId: 'forged-body-company',
        tenantId: 'forged-body-tenant',
      },
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.user.companyId, 'company-a');
    assert.equal(login.body.user.tenantId, 'company-a');
    const token = login.body.token;
    assert.ok(token);

    const companyACounterparties = await api(server.baseUrl, 'GET', '/api/counterparties', { token });
    assert.equal(companyACounterparties.status, 200, JSON.stringify(companyACounterparties.body));
    assert.deepEqual(companyACounterparties.body.map(item => item.id), ['CP-A']);
    assert.equal(companyACounterparties.body.some(item => item.id === 'CP-B'), false);

    for (const [route, expectedIds, forbiddenPattern] of [
      ['/api/knowledge_base_modules', ['KB-LEGACY', 'KB-A'], /KB-B|confidential training/i],
      ['/api/service_works', ['SW-LEGACY', 'SW-A'], /SW-B|confidential labour/i],
      ['/api/spare_parts', ['PART-LEGACY', 'PART-A'], /PART-B|B-SECRET/i],
      ['/api/service_route_norms', ['ROUTE-A'], /ROUTE-B|confidential depot/i],
      ['/api/service_work_catalog', ['SWC-A'], /SWC-B|confidential legacy work/i],
      ['/api/spare_parts_catalog', ['SPC-A'], /SPC-B|confidential legacy part/i],
    ]) {
      const response = await api(server.baseUrl, 'GET', route, { token });
      assert.equal(response.status, 200, `${route}: ${JSON.stringify(response.body)}`);
      assert.deepEqual(
        response.body.map(item => item.id).sort(),
        [...expectedIds].sort(),
        route,
      );
      assert.doesNotMatch(JSON.stringify(response.body), forbiddenPattern, route);
    }

    const createdTenantWork = await api(server.baseUrl, 'POST', '/api/service_works', {
      token,
      body: { name: 'Company A created work', normHours: 1.5, ratePerHour: 3100, isActive: true },
    });
    assert.equal(createdTenantWork.status, 201, JSON.stringify(createdTenantWork.body));
    const persistedTenantWork = await api(
      server.baseUrl,
      'GET',
      `/api/service_works/${createdTenantWork.body.id}`,
      { token },
    );
    assert.equal(persistedTenantWork.status, 200, JSON.stringify(persistedTenantWork.body));
    assert.deepEqual(persistedTenantWork.body.catalogOrigin, {
      kind: 'tenant_entry',
      logicalId: createdTenantWork.body.id,
      tenantMutable: true,
    });
    assert.equal(Object.hasOwn(persistedTenantWork.body, 'companyId'), false);
    assert.equal(Object.hasOwn(persistedTenantWork.body, 'tenantId'), false);
    assert.equal(Object.hasOwn(persistedTenantWork.body, 'platformDefaultId'), false);

    const createdTenantModule = await api(server.baseUrl, 'POST', '/api/knowledge_base_modules', {
      token,
      body: {
        title: 'Company A created module',
        section: 'manager_training',
        audience: 'all',
        isActive: true,
        quiz: [],
      },
    });
    assert.equal(createdTenantModule.status, 201, JSON.stringify(createdTenantModule.body));
    const persistedTenantModule = await api(
      server.baseUrl,
      'GET',
      `/api/knowledge_base_modules/${createdTenantModule.body.id}`,
      { token },
    );
    assert.equal(persistedTenantModule.status, 200, JSON.stringify(persistedTenantModule.body));
    assert.deepEqual(persistedTenantModule.body.catalogOrigin, {
      kind: 'tenant_entry',
      logicalId: createdTenantModule.body.id,
      tenantMutable: true,
    });
    assert.equal(Object.hasOwn(persistedTenantModule.body, 'companyId'), false);
    assert.equal(Object.hasOwn(persistedTenantModule.body, 'tenantId'), false);
    assert.equal(Object.hasOwn(persistedTenantModule.body, 'platformDefaultId'), false);

    const replacedRoutes = await api(server.baseUrl, 'PUT', '/api/service_route_norms', {
      token,
      body: [{ id: 'ROUTE-A-NEW', from: 'A depot', to: 'A new site', distanceKm: 12 }],
    });
    assert.equal(replacedRoutes.status, 200, JSON.stringify(replacedRoutes.body));
    const companyARoutes = await api(server.baseUrl, 'GET', '/api/service_route_norms', { token });
    assert.deepEqual(companyARoutes.body.map(item => item.id), ['ROUTE-A-NEW']);
    assert.deepEqual(companyARoutes.body[0].catalogOrigin, {
      kind: 'tenant_entry',
      logicalId: 'ROUTE-A-NEW',
      tenantMutable: true,
    });
    assert.equal(Object.hasOwn(companyARoutes.body[0], 'companyId'), false);
    assert.equal(Object.hasOwn(companyARoutes.body[0], 'tenantId'), false);
    assert.equal(Object.hasOwn(companyARoutes.body[0], 'platformDefaultId'), false);

    const foreignCounterparty = await api(server.baseUrl, 'GET', '/api/counterparties/CP-B', { token });
    assert.equal(foreignCounterparty.status, 404, JSON.stringify(foreignCounterparty.body));
    assert.equal(foreignCounterparty.body.code, 'COUNTERPARTY_NOT_FOUND');

    const companyAClients = await api(server.baseUrl, 'GET', '/api/clients', { token });
    assert.equal(companyAClients.status, 200, JSON.stringify(companyAClients.body));
    assert.deepEqual(companyAClients.body.map(item => item.id), ['C-A']);

    const equipmentSearchLeak = await api(server.baseUrl, 'GET', '/api/equipment?search=B-SECRET', { token });
    assert.equal(equipmentSearchLeak.status, 200, JSON.stringify(equipmentSearchLeak.body));
    assert.deepEqual(equipmentSearchLeak.body.map(item => item.id), ['EQ-A']);
    assert.doesNotMatch(JSON.stringify(equipmentSearchLeak.body), /B-SECRET|Confidential B/);
    const counterpartySearchLeak = await api(server.baseUrl, 'GET', '/api/counterparties?search=Company%20B', { token });
    assert.equal(counterpartySearchLeak.status, 200, JSON.stringify(counterpartySearchLeak.body));
    assert.deepEqual(counterpartySearchLeak.body, []);
    const foreignEquipment = await api(server.baseUrl, 'GET', '/api/equipment/EQ-B', { token });
    assert.equal(foreignEquipment.status, 404, JSON.stringify(foreignEquipment.body));
    const foreignEquipmentWrite = await api(server.baseUrl, 'PATCH', '/api/equipment/EQ-B', {
      token,
      body: { notes: 'cross-company mutation' },
    });
    assert.equal(foreignEquipmentWrite.status, 404, JSON.stringify(foreignEquipmentWrite.body));
    const foreignEquipmentDelete = await api(server.baseUrl, 'DELETE', '/api/equipment/EQ-B', { token });
    assert.equal(foreignEquipmentDelete.status, 404, JSON.stringify(foreignEquipmentDelete.body));

    const sqlDocumentSearchLeak = await api(server.baseUrl, 'GET', '/api/documents/references?search=SQL-DOCUMENT-B-SECRET', { token });
    assert.equal(sqlDocumentSearchLeak.status, 200, JSON.stringify(sqlDocumentSearchLeak.body));
    assert.deepEqual(sqlDocumentSearchLeak.body.items, []);
    const sqlDocumentIdLeak = await api(server.baseUrl, 'GET', '/api/documents/references?ids=DOC-B', { token });
    assert.equal(sqlDocumentIdLeak.status, 200, JSON.stringify(sqlDocumentIdLeak.body));
    assert.equal(sqlDocumentIdLeak.body.items.some(item => item.id === 'DOC-B'), false);
    assert.doesNotMatch(JSON.stringify(sqlDocumentIdLeak.body), /SQL-DOCUMENT-B-SECRET/);
    const sqlGanttSearchLeak = await api(server.baseUrl, 'GET', '/api/documents/gantt-references?search=SQL%20Gantt%20B%20Secret', { token });
    assert.equal(sqlGanttSearchLeak.status, 200, JSON.stringify(sqlGanttSearchLeak.body));
    assert.deepEqual(sqlGanttSearchLeak.body.items, []);
    const sqlGanttIdLeak = await api(server.baseUrl, 'GET', '/api/documents/gantt-references?rentalId=R-B', { token });
    assert.equal(sqlGanttIdLeak.status, 200, JSON.stringify(sqlGanttIdLeak.body));
    assert.deepEqual(sqlGanttIdLeak.body.items, []);

    const crossTenantRelationship = await api(server.baseUrl, 'POST', '/api/client_objects', {
      token,
      body: { clientId: 'C-B', name: 'Cross-tenant object', address: 'hidden', status: 'active' },
    });
    assert.equal(crossTenantRelationship.status >= 400, true, JSON.stringify(crossTenantRelationship.body));
    assert.doesNotMatch(JSON.stringify(crossTenantRelationship.body), /Company B client|7811111111/);

    const foreignClient = await api(server.baseUrl, 'GET', '/api/clients/C-B', { token });
    assert.equal(foreignClient.status, 404, JSON.stringify(foreignClient.body));

    const administratorForeignWrite = await api(server.baseUrl, 'PATCH', '/api/clients/C-B', {
      token,
      body: { company: 'Administrator must not bypass ownership' },
    });
    assert.equal(administratorForeignWrite.status, 404, JSON.stringify(administratorForeignWrite.body));

    const tenantUsers = await api(server.baseUrl, 'GET', '/api/users', { token });
    assert.equal(tenantUsers.status, 200, JSON.stringify(tenantUsers.body));
    assert.deepEqual(tenantUsers.body.map(user => user.id), ['U-scoped-admin']);
    assert.equal(tenantUsers.body.every(user => (
      user.password === undefined
      && user.passwordHash === undefined
      && user.token === undefined
      && user.tokenVersion === undefined
    )), true);
    assert.doesNotMatch(JSON.stringify(tenantUsers.body), new RegExp(legacyPasswordHash(TEST_PASSWORD).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(JSON.stringify(tenantUsers.body), /company-b-admin@example\.test/);

    const foreignUser = await api(server.baseUrl, 'GET', '/api/users/U-company-b-admin', { token });
    assert.equal(foreignUser.status, 404, JSON.stringify(foreignUser.body));
    const foreignUserWrite = await api(server.baseUrl, 'PATCH', '/api/users/U-company-b-admin', {
      token,
      body: { name: 'Must not mutate Company B' },
    });
    assert.equal(foreignUserWrite.status, 404, JSON.stringify(foreignUserWrite.body));

    const genericUserCreate = await api(server.baseUrl, 'POST', '/api/users', {
      token,
      body: {
        name: 'Must use Membership lifecycle',
        email: 'membership-workflow-required@example.test',
        role: 'Менеджер по аренде',
        status: 'Активен',
        password: TEST_PASSWORD,
      },
    });
    assert.equal(genericUserCreate.status, 409, JSON.stringify(genericUserCreate.body));
    assert.equal(genericUserCreate.body.code, 'USER_MEMBERSHIP_WORKFLOW_REQUIRED');

    for (const route of [
      '/api/admin/backup/full',
      '/api/admin/backup/history',
      '/api/admin/system-control-center',
    ]) {
      const platformOperation = await api(server.baseUrl, 'GET', route, { token });
      assert.equal(platformOperation.status, 403, `${route}: ${JSON.stringify(platformOperation.body)}`);
      assert.equal(platformOperation.body.code, 'PLATFORM_OPERATOR_REQUIRED');
    }

    const scopedExport = await api(server.baseUrl, 'GET', '/api/admin/system-data/export', { token });
    assert.equal(scopedExport.status, 200, JSON.stringify(scopedExport.body));
    assert.deepEqual(scopedExport.body.collections.counterparties.map(item => item.id), ['CP-A']);
    assert.deepEqual(scopedExport.body.collections.clients.map(item => item.id), ['C-A']);
    assert.deepEqual(scopedExport.body.collections.equipment.map(item => item.id), ['EQ-A']);
    assert.doesNotMatch(JSON.stringify(scopedExport.body), /B-SECRET|B-secret|AUDIT-B/);

    const auditView = await api(server.baseUrl, 'GET', '/api/admin/audit-logs', { token });
    assert.equal(auditView.status, 200, JSON.stringify(auditView.body));
    assert.equal(auditView.body.logs.some(item => item.id === 'AUDIT-A'), true);
    assert.equal(auditView.body.logs.every(item => item.companyId === undefined), true, 'safe audit DTO hides ownership internals');
    assert.doesNotMatch(JSON.stringify(auditView.body), /equipment\.secret|AUDIT-B/);

    const publicSettings = await api(server.baseUrl, 'GET', '/api/public-settings');
    assert.equal(publicSettings.status, 200, JSON.stringify(publicSettings.body));
    assert.deepEqual(publicSettings.body, []);

    await stopActualServer(server);
    server = null;

    const sessionDb = new Database(dbPath, { readonly: true });
    try {
      const row = sessionDb.prepare('SELECT json FROM app_sessions WHERE token = ?').get(token);
      const storedSession = JSON.parse(row.json);
      assert.equal(storedSession.actorScope.companyId, 'company-a');
      assert.equal(storedSession.actorScope.tenantId, 'company-a');
      assert.equal(storedSession.actorScope.membershipId, 'membership-scoped-admin');
    } finally {
      sessionDb.close();
    }

    server = await startActualServer(dbPath);
    const restored = await api(server.baseUrl, 'GET', '/api/auth/me', { token });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.user.companyId, 'company-a');
    assert.equal(restored.body.user.tenantId, 'company-a');

    const rejectedOverride = await api(server.baseUrl, 'POST', '/api/counterparties', {
      token,
      body: {
        type: 'legal_entity',
        legalName: 'ООО Forged Ownership',
        shortName: 'Forged Ownership',
        inn: '7707083893',
        roles: ['supplier'],
        companyId: 'company-foreign',
      },
    });
    assert.equal(rejectedOverride.status, 409);
    assert.equal(rejectedOverride.body.code, 'MASTER_DATA_SCOPE_CLIENT_SUPPLIED');

    const created = await api(server.baseUrl, 'POST', '/api/counterparties', {
      token,
      headers: {
        'x-company-id': 'forged-header-company',
        'x-tenant-id': 'forged-header-tenant',
      },
      body: {
        type: 'legal_entity',
        legalName: 'ООО Server Scope E2E',
        shortName: 'Server Scope E2E',
        inn: '7707083894',
        roles: ['supplier'],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.companyId, 'company-a');
    assert.equal(created.body.tenantId, 'company-a');

    const addedRole = await api(server.baseUrl, 'POST', `/api/counterparties/${created.body.id}/roles`, {
      token,
      body: { role: 'customer' },
    });
    assert.equal(addedRole.status, 200, JSON.stringify(addedRole.body));
    assert.notEqual(addedRole.body.code, 'COUNTERPARTY_SCOPE_UNKNOWN');

    const reloadedRoles = await api(server.baseUrl, 'GET', `/api/counterparties/${created.body.id}/roles`, { token });
    assert.equal(reloadedRoles.status, 200);
    assert.deepEqual(reloadedRoles.body.roles, ['customer', 'supplier']);
    assert.ok(reloadedRoles.body.assignments.every(item => (
      item.companyId === 'company-a' && item.tenantId === 'company-a'
    )));
    assert.equal(reloadedRoles.body.profiles.supplier.companyId, 'company-a');
    assert.equal(reloadedRoles.body.profiles.supplier.tenantId, 'company-a');

    const archived = await api(server.baseUrl, 'DELETE', `/api/counterparties/${created.body.id}`, { token });
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    const reloadedCounterparty = await api(server.baseUrl, 'GET', `/api/counterparties/${created.body.id}`, { token });
    assert.equal(reloadedCounterparty.status, 200);
    assert.equal(reloadedCounterparty.body.status, 'archived');
    assert.equal(reloadedCounterparty.body.companyId, 'company-a');
    assert.equal(reloadedCounterparty.body.tenantId, 'company-a');

    const client = await api(server.baseUrl, 'POST', '/api/clients', {
      token,
      body: {
        company: 'ООО Client Scope E2E',
        inn: '7707083895',
        contact: 'Иван',
        phone: '+79991234567',
        email: 'client-scope@example.test',
        paymentTerms: 'Постоплата 14 дней',
      },
    });
    assert.equal(client.status, 201, JSON.stringify(client.body));
    assert.equal(client.body.companyId, 'company-a');
    assert.equal(client.body.tenantId, 'company-a');

    const object = await api(server.baseUrl, 'POST', '/api/client_objects', {
      token,
      body: {
        clientId: client.body.id,
        name: 'E2E Object',
        address: 'Казань',
        status: 'active',
      },
    });
    assert.equal(object.status, 201, JSON.stringify(object.body));
    assert.equal(object.body.companyId, 'company-a');
    assert.equal(object.body.tenantId, 'company-a');

    const archivedObject = await api(server.baseUrl, 'POST', `/api/client_objects/${object.body.id}/archive`, {
      token,
      body: {},
    });
    assert.equal(archivedObject.status, 200, JSON.stringify(archivedObject.body));
    const reloadedObject = await api(server.baseUrl, 'GET', `/api/client_objects/${object.body.id}`, { token });
    assert.equal(reloadedObject.status, 200);
    assert.equal(reloadedObject.body.status, 'archived');
    assert.equal(reloadedObject.body.companyId, 'company-a');
    assert.equal(reloadedObject.body.tenantId, 'company-a');

    const contract = await api(server.baseUrl, 'POST', '/api/client_contracts', {
      token,
      body: {
        clientId: client.body.id,
        status: 'active',
      },
    });
    assert.equal(contract.status, 201, JSON.stringify(contract.body));
    assert.equal(contract.body.companyId, 'company-a');
    assert.equal(contract.body.tenantId, 'company-a');

    const companyBLogin = await api(server.baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'company-b-admin@example.test', password: TEST_PASSWORD },
    });
    assert.equal(companyBLogin.status, 200, JSON.stringify(companyBLogin.body));
    const companyBCounterparties = await api(server.baseUrl, 'GET', '/api/counterparties', {
      token: companyBLogin.body.token,
    });
    assert.deepEqual(companyBCounterparties.body.map(item => item.id), ['CP-B']);
    const companyBWorks = await api(server.baseUrl, 'GET', '/api/service_works', {
      token: companyBLogin.body.token,
    });
    assert.deepEqual(
      companyBWorks.body.map(item => item.id).sort(),
      ['SW-LEGACY', 'SW-B'].sort(),
    );
    assert.deepEqual(
      companyBWorks.body.find(item => item.id === 'SW-LEGACY').catalogOrigin,
      {
        kind: 'platform_default',
        logicalId: 'SW-LEGACY',
        tenantMutable: false,
      },
    );
    assert.doesNotMatch(JSON.stringify(companyBWorks.body), /SW-A|Company A created work/);
    const companyBRoutes = await api(server.baseUrl, 'GET', '/api/service_route_norms', {
      token: companyBLogin.body.token,
    });
    assert.deepEqual(companyBRoutes.body.map(item => item.id), ['ROUTE-B']);
    const companyBContract = await api(server.baseUrl, 'POST', '/api/client_contracts', {
      token: companyBLogin.body.token,
      body: { clientId: 'C-B', status: 'active' },
    });
    assert.equal(companyBContract.status, 201, JSON.stringify(companyBContract.body));
    assert.equal(companyBContract.body.companyId, 'company-b');
    assert.equal(companyBContract.body.tenantId, 'company-b');
    assert.equal(companyBContract.body.number, contract.body.number, 'number sequences must be tenant-local');

    await stopActualServer(server);
    server = null;
    const beforeRejectedWrite = readDatabaseState(dbPath);

    server = await startActualServer(dbPath);
    const unscopedLogin = await api(server.baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'unscoped-admin@example.test', password: TEST_PASSWORD },
    });
    assert.equal(unscopedLogin.status, 403, JSON.stringify(unscopedLogin.body));
    assert.equal(unscopedLogin.body.code, 'ACTOR_SCOPE_INCOMPLETE');
    assert.equal(unscopedLogin.body.token, undefined);

    for (const email of ['ambiguous-admin@example.test', 'inactive-company-admin@example.test']) {
      const authorityLogin = await api(server.baseUrl, 'POST', '/api/auth/login', {
        body: { email, password: TEST_PASSWORD },
      });
      assert.equal(authorityLogin.status, 403, JSON.stringify(authorityLogin.body));
      assert.equal(authorityLogin.body.code, 'ACTOR_SCOPE_INCOMPLETE');
      assert.equal(authorityLogin.body.token, undefined);
    }

    await stopActualServer(server);
    server = null;
    const afterRejectedWrite = readDatabaseState(dbPath);
    for (const collection of [
      'counterparties',
      'assignments',
      'supplierProfiles',
      'contractorProfiles',
      'clients',
      'clientObjects',
      'clientContracts',
    ]) {
      assert.equal(afterRejectedWrite[collection].length, beforeRejectedWrite[collection].length);
    }
    assert.equal(
      afterRejectedWrite.counterparties.some(item => item.legalName === 'ООО Must Not Persist'),
      false,
    );
    assert.equal(
      afterRejectedWrite.auditLogs.filter(item => item.action === 'counterparties.create').length,
      beforeRejectedWrite.auditLogs.filter(item => item.action === 'counterparties.create').length,
    );
  } finally {
    await stopActualServer(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
