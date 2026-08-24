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

    await stopActualServer(server);
    server = null;
    const beforeRejectedWrite = readDatabaseState(dbPath);

    server = await startActualServer(dbPath);
    const unscopedLogin = await api(server.baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'unscoped-admin@example.test', password: TEST_PASSWORD },
    });
    assert.equal(unscopedLogin.status, 200, JSON.stringify(unscopedLogin.body));
    assert.equal(unscopedLogin.body.user.companyId, undefined);
    assert.equal(unscopedLogin.body.user.tenantId, undefined);

    const incompleteCreate = await api(server.baseUrl, 'POST', '/api/counterparties', {
      token: unscopedLogin.body.token,
      body: {
        type: 'legal_entity',
        legalName: 'ООО Must Not Persist',
        shortName: 'Must Not Persist',
        inn: '7707083896',
        roles: ['supplier'],
      },
    });
    assert.equal(incompleteCreate.status, 403, JSON.stringify(incompleteCreate.body));
    assert.equal(incompleteCreate.body.code, 'ACTOR_SCOPE_INCOMPLETE');

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
