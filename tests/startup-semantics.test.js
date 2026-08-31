import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { testActor } from './platform-identity-fixtures.js';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  createPlatformIdentityRepository,
} = serverRequire('./lib/platform-identity-repository.js');
const {
  DELETED_TABLES: OPERATIONAL_SQL_TABLES,
} = serverRequire('./lib/skytech-clean-production-reset.js');

const SERVER_DIRECTORY = path.resolve('server');
const SERVER_ENTRY = path.join(SERVER_DIRECTORY, 'server.js');
const STARTUP_MUTATION_ENV = Object.freeze([
  'ADMIN_RESET_EMAIL',
  'ADMIN_RESET_PASSWORD',
  'BOOTSTRAP_ADMIN_EMAIL',
  'BOOTSTRAP_ADMIN_PASSWORD',
  'DEV_SEED_PASSWORD',
  'ENABLE_DEV_DEFAULT_USERS',
  'PRE_COMPATIBILITY_BACKUP_AUTHORIZATION',
  'PRE_COMPATIBILITY_BACKUP_OUTPUT',
  'PRODUCTION_SCOPE_SCHEMA_COMPATIBILITY',
  'PRODUCTION_SCOPE_WRITE_FREEZE',
  'PRODUCTION_VALIDATION_READ_ONLY',
  'SERVICE_CREATED_AT_BACKFILL',
  'SKYTECH_CLEAN_RESET_ENABLED',
  'STARTUP_BUSINESS_MAINTENANCE',
]);

async function reservePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close(error => (
    error ? reject(error) : resolve()
  )));
  return port;
}

function isolatedStartupEnvironment({ dbPath, port }) {
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
  for (const name of STARTUP_MUTATION_ENV) delete env[name];
  return env;
}

async function startActualServer(dbPath) {
  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_DIRECTORY,
    env: isolatedStartupEnvironment({ dbPath, port }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = chunk => {
    output = `${output}${String(chunk)}`.slice(-20_000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Actual server exited during startup (${child.exitCode}).\n${output}`);
    }
    try {
      const health = await fetch(`${baseUrl}/health`);
      if (health.ok) return { child, getOutput: () => output };
    } catch {
      // Listener is not ready yet.
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
  const timer = setTimeout(() => server.child.kill('SIGKILL'), 3_000);
  await exited;
  clearTimeout(timer);
}

function startupSnapshot(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tableCounts = {};
    for (const table of [
      'authorization_audit_events',
      'canonical_branches',
      'canonical_companies',
      'capability_catalog_entries',
      'capability_catalog_versions',
      'company_memberships',
      'identity_bootstrap_runs',
      'role_templates',
      'sql_shadow_schema_migrations',
    ]) {
      tableCounts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    }
    const operationalTableCounts = Object.fromEntries(OPERATIONAL_SQL_TABLES.map(table => [
      table,
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    ]));
    return {
      appData: db.prepare('SELECT name, json FROM app_data ORDER BY name').all(),
      clientInnIndex: db.prepare(`
        SELECT inn_normalized, client_id, company
        FROM client_inn_index
        ORDER BY inn_normalized
      `).all(),
      operationalTableCounts,
      tableCounts,
    };
  } finally {
    db.close();
  }
}

function appDataUpsert(db) {
  return db.prepare(`
    INSERT INTO app_data (name, json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      json = excluded.json,
      updated_at = CURRENT_TIMESTAMP
  `);
}

test('real startup is safe for clean, legacy, and provisioned databases', {
  timeout: 45_000,
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-startup-semantics-'));
  const dbPath = path.join(directory, 'app.sqlite');
  let server;
  t.after(async () => {
    await stopActualServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  // Clean DB: schema/global capability bootstrap is allowed, but there is no
  // Company and no tenant or system app_data row without explicit credentials.
  server = await startActualServer(dbPath);
  await stopActualServer(server);
  server = null;
  const clean = startupSnapshot(dbPath);
  assert.deepEqual(clean.appData, []);
  assert.deepEqual(clean.clientInnIndex, []);
  assert.deepEqual(
    Object.entries(clean.operationalTableCounts).filter(([, count]) => count !== 0),
    [],
  );
  assert.equal(clean.tableCounts.canonical_companies, 0);
  assert.equal(clean.tableCounts.canonical_branches, 0);
  assert.equal(clean.tableCounts.company_memberships, 0);
  assert.equal(clean.tableCounts.identity_bootstrap_runs, 0);
  assert.equal(clean.tableCounts.capability_catalog_versions, 1);
  assert.ok(clean.tableCounts.capability_catalog_entries > 0);
  assert.ok(clean.tableCounts.sql_shadow_schema_migrations > 0);

  // Existing legacy DB: business JSON remains byte-for-byte unchanged. The
  // only expected data projection is the rebuildable legacy INN index.
  let db = new Database(dbPath);
  let upsert = appDataUpsert(db);
  const legacyCollections = {
    clients: [{
      id: 'legacy-client',
      company: 'Legacy client',
      inn: '7707083893',
      innNormalized: '7707083893',
    }],
    rentals: [{ id: 'legacy-rental', client: 'Legacy client' }],
    service_works: [{ id: 'legacy-work', name: 'Legacy work' }],
  };
  for (const [name, value] of Object.entries(legacyCollections)) {
    upsert.run(name, JSON.stringify(value));
  }
  db.close();
  const legacyBefore = startupSnapshot(dbPath);

  server = await startActualServer(dbPath);
  await stopActualServer(server);
  server = null;
  const legacyAfter = startupSnapshot(dbPath);
  assert.deepEqual(legacyAfter.appData, legacyBefore.appData);
  assert.equal(legacyAfter.tableCounts.canonical_companies, 0);
  assert.deepEqual(legacyAfter.clientInnIndex, [{
    inn_normalized: 'legacy-unscoped|7707083893',
    client_id: 'legacy-client',
    company: 'Legacy client',
  }]);
  assert.equal(legacyAfter.operationalTableCounts.client_inn_index, 1);
  assert.deepEqual(
    Object.entries(legacyAfter.operationalTableCounts).filter(([table, count]) => (
      table !== 'client_inn_index' && count !== 0
    )),
    [],
  );

  // Provisioning occurs only after startup, through trusted platform identity.
  // A subsequent backend start must preserve both authority and tenant data.
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  upsert = appDataUpsert(db);
  const users = [{
    id: 'U-admin',
    name: 'Stage 5 provisioner',
    role: 'Администратор',
    status: 'Активен',
  }];
  upsert.run('users', JSON.stringify(users));
  let sequence = 0;
  const identity = createPlatformIdentityRepository(db, {
    readUsers: () => users,
    nowIso: () => `2026-08-30T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    generateId: prefix => `${prefix}-stage5-${++sequence}`,
  });
  identity.createCompanyAuthority({
    company: {
      id: 'company-stage5',
      displayName: 'Stage 5 Company',
      receivablesTimezone: 'Europe/Moscow',
    },
    branches: [{
      id: 'branch-stage5',
      displayName: 'Head Office',
      isHeadOffice: true,
      status: 'active',
    }],
    actorContext: testActor(),
    reason: 'stage5-startup-proof',
  });
  upsert.run('equipment', JSON.stringify([{
    id: 'EQ-stage5',
    companyId: 'company-stage5',
    tenantId: 'company-stage5',
    status: 'available',
  }]));
  db.close();
  const provisionedBefore = startupSnapshot(dbPath);

  server = await startActualServer(dbPath);
  await stopActualServer(server);
  server = null;
  const provisionedAfter = startupSnapshot(dbPath);
  assert.deepEqual(provisionedAfter.appData, provisionedBefore.appData);
  assert.deepEqual(provisionedAfter.clientInnIndex, provisionedBefore.clientInnIndex);
  assert.deepEqual(provisionedAfter.tableCounts, provisionedBefore.tableCounts);
  assert.equal(provisionedAfter.tableCounts.canonical_companies, 1);
  assert.equal(provisionedAfter.tableCounts.canonical_branches, 1);
  assert.equal(provisionedAfter.tableCounts.authorization_audit_events, 2);
});
