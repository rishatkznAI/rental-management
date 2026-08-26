import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const express = serverRequire('express');
const {
  assertPreCompatibilityBackupEnvironment,
  databaseLogicalDigest,
} = require('../server/lib/pre-compatibility-backup.js');
const {
  createExclusiveSourceProvider,
  openVerifiedReadOnlyDatabase,
} = require('../server/pre-compatibility-backup-server.js');
const {
  registerPreCompatibilityBackupControlRoutes,
  registerPreCompatibilityBackupRoute,
} = require('../server/routes/pre-compatibility-backup.js');
const {
  createPreCompatibilityBackupCoordinator,
} = require('../server/lib/pre-compatibility-backup-coordinator.js');
const {
  resolveServerEntry,
} = require('../server/scripts/start-with-release-type.cjs');
const {
  crc32,
} = require('../server/lib/zip-store.js');

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-compatibility-backup-'));
  const dbPath = path.join(root, 'app.sqlite');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE app_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE sql_shadow_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE capability_catalog_versions (
      version INTEGER PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE capability_catalog_entries (
      version INTEGER NOT NULL,
      capability TEXT NOT NULL,
      PRIMARY KEY (version, capability)
    );
    CREATE TABLE client_inn_index (
      client_id TEXT PRIMARY KEY,
      inn TEXT NOT NULL
    );
    CREATE TABLE documents_sql (
      id TEXT PRIMARY KEY,
      client_id TEXT
    );
    CREATE TRIGGER documents_sql_cleanup
    AFTER DELETE ON documents_sql
    BEGIN
      DELETE FROM client_inn_index WHERE client_id = OLD.client_id;
    END;
    CREATE TABLE number_sequence_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE number_sequences (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      year INTEGER NOT NULL,
      last_value INTEGER NOT NULL,
      PRIMARY KEY (scope_type, scope_id, entity_type, year)
    );
    CREATE TABLE business_numbers (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      year INTEGER NOT NULL,
      number INTEGER NOT NULL
    );
    CREATE TABLE future_extension_table (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
  `);
  const values = {
    users: [{ id: 'U-1', email: 'admin@example.test', passwordHash: 'sealed', role: 'Администратор' }],
    app_settings: [],
    bot_users: { 'max-1': { id: 'max-1', userId: 'U-1', role: 'Администратор' } },
    knowledge_base_modules: [{ id: 'KB-1', title: 'Reference' }],
    service_works: [{ id: 'SW-1', name: 'Diagnostics' }],
    spare_parts: [{ id: 'SP-1', name: 'Filter' }],
    service_route_norms: [{ id: 'RN-1', km: 25 }],
    service_work_catalog: [],
    spare_parts_catalog: [],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1' }],
    counterparties: [{ id: 'CP-1', legalName: 'Client' }],
    equipment: [{ id: 'E-1' }],
    rentals: [{ id: 'R-1', clientId: 'C-1', equipmentId: 'E-1' }],
    gantt_rentals: [{ id: 'GR-1', rentalId: 'R-1' }],
    payments: [{ id: 'P-1', clientId: 'C-1', amount: 100 }],
    payment_allocations: [{ id: 'PA-1', paymentId: 'P-1', rentalId: 'R-1', amount: 100 }],
    documents: [{ id: 'D-1', clientId: 'C-1', mimetype: 'image/jpeg' }],
    service: [{ id: 'S-1', equipmentId: 'E-1' }],
    deliveries: [{ id: 'DL-1', rentalId: 'R-1' }],
    bot_sessions: { 'max-1': { scenario: 'old-rental' } },
    audit_logs: [{ id: 'A-1', entityType: 'clients', entityId: 'C-1' }],
    snapshot: { clients: 1 },
    service_work_names: [{ id: 'SWN-1', name: 'Diagnostics' }],
    spare_part_names: [{ id: 'SPN-1', name: 'Filter' }],
    client_history: [{ id: 'CH-1', clientId: 'C-1' }],
    client_object_history: [{ id: 'COH-1', clientObjectId: 'CO-1' }],
    domain_history: [{ id: 'DH-1', entityType: 'clients', entityId: 'C-1' }],
    future_extension_collection: [{ id: 'FEC-1' }],
  };
  const insert = db.prepare('INSERT INTO app_data(name, json, updated_at) VALUES (?, ?, ?)');
  for (const [name, value] of Object.entries(values)) {
    insert.run(name, JSON.stringify(value), '2026-08-26T00:00:00.000Z');
  }
  db.prepare('INSERT INTO app_sessions VALUES (?, ?, ?)').run('session', 'U-1', '2027-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO sql_shadow_schema_migrations VALUES (?, ?)').run(1, 'initial');
  db.prepare('INSERT INTO capability_catalog_versions VALUES (?, ?)').run(1, 'active');
  db.prepare('INSERT INTO capability_catalog_entries VALUES (?, ?)').run(1, 'clients.read');
  db.prepare('INSERT INTO client_inn_index VALUES (?, ?)').run('C-1', '1234567890');
  db.prepare('INSERT INTO documents_sql VALUES (?, ?)').run('D-1', 'C-1');
  db.prepare('INSERT INTO number_sequence_schema_migrations VALUES (?, ?)').run(1, '2026-08-26T00:00:00.000Z');
  db.prepare('INSERT INTO number_sequences VALUES (?, ?, ?, ?, ?)').run('COMPANY', 'C-1', 'INVOICE', 2026, 7);
  db.prepare('INSERT INTO business_numbers VALUES (?, ?, ?, ?, ?, ?)').run('BN-1', 'COMPANY', 'C-1', 'INVOICE', 2026, 7);
  db.prepare('INSERT INTO future_extension_table VALUES (?, ?)').run('FET-1', 'preserve exactly');
  const uploads = path.join(root, 'uploads', 'equipment');
  fs.mkdirSync(uploads, { recursive: true });
  fs.writeFileSync(path.join(uploads, 'photo.jpg'), 'business-photo');
  return { root, dbPath: fs.realpathSync(dbPath), writerDb: db };
}

function expectedEnvironment(dbPath) {
  return {
    projectId: 'project',
    environmentId: 'environment',
    serviceId: 'service',
    volumeName: 'volume',
    volumeMountPath: path.dirname(dbPath),
    sourceDbPath: dbPath,
  };
}

function frozenEnvironment(dbPath) {
  return {
    NODE_ENV: 'production',
    DB_PATH: dbPath,
    RAILWAY_PROJECT_ID: 'project',
    RAILWAY_ENVIRONMENT_ID: 'environment',
    RAILWAY_SERVICE_ID: 'service',
    RAILWAY_VOLUME_NAME: 'volume',
    RAILWAY_VOLUME_MOUNT_PATH: path.dirname(dbPath),
    RAILWAY_REPLICA_ID: 'replica',
    RAILWAY_DEPLOYMENT_ID: 'deployment',
    RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
    PRODUCTION_SCOPE_REMEDIATION_ENABLED: 'true',
    PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE: 'true',
    PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY: 'false',
    PRODUCTION_SCOPE_REMEDIATION_VALIDATION_READ_ONLY: 'false',
    PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES: '',
    PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE: '',
    PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET: '',
    APP_DISABLED: 'true',
    BOT_DISABLED: 'true',
    GSM_DISABLED: 'true',
    GSM_ENABLED: 'false',
    SKYTECH_CLEAN_RESET_ENABLED: 'false',
    SKYTECH_CLEAN_RESET_TOKEN: '',
    SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED: 'true',
    SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA: 'a'.repeat(40),
    SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN: 'b'.repeat(32),
    ADMIN_RESET_PASSWORD: '',
  };
}

async function withServer(app, operation) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    return await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function waitForCoordinatorStatus(coordinator, identity, expectedStatus) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = coordinator.status(identity);
    if (state?.status === expectedStatus) return state;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`coordinator did not reach ${expectedStatus}`);
}

test('pre-compatibility environment gate requires the exact raw runtime SHA and isolated controls', () => {
  const fixture = createFixture();
  try {
    const expected = expectedEnvironment(fixture.dbPath);
    const env = frozenEnvironment(fixture.dbPath);
    assert.equal(assertPreCompatibilityBackupEnvironment(env, {
      dbPath: fixture.dbPath,
      expectedEnvironment: expected,
    }), true);
    for (const [name, value] of [
      ['SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED', 'false'],
      ['RAILWAY_GIT_COMMIT_SHA', 'A'.repeat(40)],
      ['SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA', 'c'.repeat(40)],
      ['PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE', 'false'],
      ['SKYTECH_CLEAN_RESET_ENABLED', 'true'],
      ['SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN', 'short'],
    ]) {
      assert.throws(
        () => assertPreCompatibilityBackupEnvironment({ ...env, [name]: value }, {
          dbPath: fixture.dbPath,
          expectedEnvironment: expected,
        }),
        error => error?.code === 'PRE_COMPATIBILITY_BACKUP_CONSERVATION_REQUIRED',
        name,
      );
    }
  } finally {
    fixture.writerDb.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('backup-only route keeps the source query-only and exposes no reset operation', async () => {
  const fixture = createFixture();
  const expected = expectedEnvironment(fixture.dbPath);
  const env = frozenEnvironment(fixture.dbPath);
  const requestNonce = '11111111-1111-4111-8111-111111111111';
  let sourceProvider;
  try {
    fixture.writerDb.close();
    const archivedBusinessFile = Buffer.from('d1b38d1695b74b21c2eaaf8c', 'hex');
    const collidingBusinessFile = Buffer.from('aba42b61c4409482e62db41d', 'hex');
    assert.notDeepEqual(archivedBusinessFile, collidingBusinessFile);
    assert.equal(crc32(archivedBusinessFile), crc32(collidingBusinessFile));
    const businessFilePath = path.join(fixture.root, 'uploads', 'equipment', 'photo.jpg');
    fs.writeFileSync(businessFilePath, archivedBusinessFile);
    const beforeSha = sha256(fixture.dbPath);
    const retainedSource = openVerifiedReadOnlyDatabase({
      dbPath: fixture.dbPath,
      expectedEnvironment: expected,
      env,
    });
    sourceProvider = createExclusiveSourceProvider(retainedSource);
    const startupSourceIdentity = sourceProvider.sourceIdentity;
    assert.equal(retainedSource.db.pragma('query_only', { simple: true }), 1);
    assert.throws(() => retainedSource.db.prepare("UPDATE app_data SET json = '[]'").run(), /readonly|read-only/i);

    const app = express();
    const router = express.Router();
    app.use(express.json());
    registerPreCompatibilityBackupRoute(router, {
      dbPath: fixture.dbPath,
      openSourceDatabase: () => sourceProvider.acquire(),
      startupSourceIdentity,
      buildInfo: () => ({
        commit: env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7),
        commitFull: env.RAILWAY_GIT_COMMIT_SHA,
        startedAt: '2026-08-26T00:00:00.000Z',
        deployment: {
          railwayDeploymentId: env.RAILWAY_DEPLOYMENT_ID,
          railwayEnvironment: 'production',
          railwayService: 'rental-management',
          railwayReplicaId: env.RAILWAY_REPLICA_ID,
        },
      }),
      expectedEnvironment: expected,
      isBackupOnlyRuntime: () => true,
      env,
      now: () => new Date('2026-08-26T12:34:56.000Z'),
      randomUUID: () => '22222222-2222-4222-8222-222222222222',
    });
    app.use('/api', router);

    await withServer(app, async baseUrl => {
      const endpoint = `${baseUrl}/api/admin/skytech-pre-compatibility-backup`;
      for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
        const response = await fetch(endpoint, {
          method,
          headers: { 'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN },
        });
        assert.equal(response.status, 404, method);
      }
      for (const suffix of ['dry-run', 'verify']) {
        const response = await fetch(`${baseUrl}/api/admin/skytech-clean-reset/${suffix}`, {
          headers: { 'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN },
        });
        assert.equal(response.status, 404, suffix);
      }
      const wrongCredential = await fetch(endpoint, {
        method: 'POST',
        headers: { 'X-Skytech-Reset-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN },
      });
      assert.equal(wrongCredential.status, 403);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
          'X-Skytech-Pre-Compatibility-Backup-Nonce': requestNonce,
        },
        body: JSON.stringify({ mode: 'apply', confirmation: 'ignored' }),
      });
      const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body));
      assert.equal(body.backup.databaseIntegrity, 'ok');
      assert.equal(body.backup.databaseForeignKeyViolations, 0);
      assert.equal(body.backup.skippedFilesCount, 0);
      assert.equal(body.backup.businessFileCount, 1);
      assert.match(body.backup.businessFileInventorySha256, /^[a-f0-9]{64}$/);
      assert.equal(body.backup.requestNonce, requestNonce);
      assert.equal(body.backup.operationId, '22222222-2222-4222-8222-222222222222');
      assert.deepEqual(body.backup.collectionCounts, {});
      assert.deepEqual(body.backup.sourceStateBefore.database, body.backup.sourceStateAfter.database);
      assert.deepEqual(body.backup.sourceStateBefore.wal, body.backup.sourceStateAfter.wal);
      assert.match(body.backup.sha256, /^[a-f0-9]{64}$/);
      assert.equal(sha256(path.join(fixture.root, 'backups', body.backup.filename)), body.backup.sha256);
      const receiptPath = path.join(fixture.root, 'backups', body.backup.receiptFilename);
      assert.equal(sha256(receiptPath), body.backup.receiptSha256);
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      assert.equal(receipt.status, 'COMPLETE');
      assert.equal(receipt.requestNonce, requestNonce);
      assert.equal(receipt.source.durableStateUnchanged, true);

      const retry = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
          'X-Skytech-Pre-Compatibility-Backup-Nonce': requestNonce,
        },
      });
      const retryBody = await retry.json();
      assert.equal(retry.status, 200, JSON.stringify(retryBody));
      assert.equal(retryBody.idempotent, true);
      assert.equal(retryBody.backup.operationId, body.backup.operationId);
      assert.equal(fs.readdirSync(path.join(fixture.root, 'backups')).filter(name => name.endsWith('.zip')).length, 1);

      fs.writeFileSync(businessFilePath, collidingBusinessFile);
      const crcCollisionRetry = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
          'X-Skytech-Pre-Compatibility-Backup-Nonce': requestNonce,
        },
      });
      assert.equal(crcCollisionRetry.status, 409);

      const differentNonce = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
          'X-Skytech-Pre-Compatibility-Backup-Nonce': '33333333-3333-4333-8333-333333333333',
        },
      });
      assert.equal(differentNonce.status, 409);
    });
    assert.equal(sha256(fixture.dbPath), beforeSha);
  } finally {
    sourceProvider?.close();
    if (fixture.writerDb.open) fixture.writerDb.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('backup-only route preserves a future SQLite schema with no app_data table', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-compatibility-generic-schema-'));
  const rawDbPath = path.join(root, 'app.sqlite');
  const writerDb = new Database(rawDbPath);
  writerDb.pragma('foreign_keys = ON');
  writerDb.pragma('journal_mode = WAL');
  writerDb.exec(`
    CREATE TABLE future_authority (
      id TEXT PRIMARY KEY,
      payload BLOB NOT NULL
    );
  `);
  writerDb.prepare('INSERT INTO future_authority VALUES (?, ?)').run('future-1', Buffer.from('preserve'));
  fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'uploads', 'future.bin'), 'future-file');
  const dbPath = fs.realpathSync(rawDbPath);
  const expected = expectedEnvironment(dbPath);
  const env = frozenEnvironment(dbPath);
  let sourceProvider;
  try {
    writerDb.close();
    const retainedSource = openVerifiedReadOnlyDatabase({ dbPath, expectedEnvironment: expected, env });
    sourceProvider = createExclusiveSourceProvider(retainedSource);
    const startupSourceIdentity = sourceProvider.sourceIdentity;
    const app = express();
    const router = express.Router();
    registerPreCompatibilityBackupRoute(router, {
      dbPath,
      openSourceDatabase: () => sourceProvider.acquire(),
      startupSourceIdentity,
      buildInfo: () => ({
        commit: env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7),
        commitFull: env.RAILWAY_GIT_COMMIT_SHA,
        startedAt: '2026-08-26T00:00:00.000Z',
        deployment: {
          railwayDeploymentId: env.RAILWAY_DEPLOYMENT_ID,
          railwayEnvironment: 'production',
          railwayService: 'rental-management',
          railwayReplicaId: env.RAILWAY_REPLICA_ID,
        },
      }),
      expectedEnvironment: expected,
      isBackupOnlyRuntime: () => true,
      env,
      now: () => new Date('2026-08-26T12:34:57.000Z'),
      randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    app.use('/api', router);
    await withServer(app, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/skytech-pre-compatibility-backup`, {
        method: 'POST',
        headers: {
          'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
          'X-Skytech-Pre-Compatibility-Backup-Nonce': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      });
      const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body));
      assert.deepEqual(body.backup.collectionCounts, {});
      assert.equal(body.backup.databaseIntegrity, 'ok');
      assert.equal(body.backup.skippedFilesCount, 0);
      assert.equal(body.backup.includedFilesCount, 1);
      assert.equal(body.backup.businessFileCount, 1);
      assert.match(body.backup.businessFileInventorySha256, /^[a-f0-9]{64}$/);
    });
  } finally {
    sourceProvider?.close();
    if (writerDb.open) writerDb.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('logical database digest preserves distinct 64-bit SQLite integers', () => {
  const left = new Database(':memory:');
  const right = new Database(':memory:');
  try {
    for (const db of [left, right]) db.exec('CREATE TABLE exact_integer (value INTEGER NOT NULL)');
    left.prepare('INSERT INTO exact_integer(value) VALUES (?)').run(9_007_199_254_740_992n);
    right.prepare('INSERT INTO exact_integer(value) VALUES (?)').run(9_007_199_254_740_993n);
    assert.notEqual(databaseLogicalDigest(left), databaseLogicalDigest(right));
  } finally {
    left.close();
    right.close();
  }
});

test('SQLite constructor path ABA cannot satisfy the retained inode proof', () => {
  const fixture = createFixture();
  const expected = expectedEnvironment(fixture.dbPath);
  const env = frozenEnvironment(fixture.dbPath);
  const displacedPath = path.join(fixture.root, 'verified-source.sqlite');
  const replacementPath = path.join(fixture.root, 'replacement.sqlite');
  try {
    fixture.writerDb.close();
    fs.copyFileSync(fixture.dbPath, replacementPath, fs.constants.COPYFILE_EXCL);
    function AbaDatabaseConstructor(filename, options) {
      fs.renameSync(filename, displacedPath);
      fs.renameSync(replacementPath, filename);
      let connection;
      try {
        connection = new Database(filename, options);
      } finally {
        fs.renameSync(filename, replacementPath);
        fs.renameSync(displacedPath, filename);
      }
      return connection;
    }
    assert.throws(
      () => openVerifiedReadOnlyDatabase({
        dbPath: fixture.dbPath,
        expectedEnvironment: expected,
        env,
        DatabaseConstructor: AbaDatabaseConstructor,
      }),
      error => error?.code === 'PRE_COMPATIBILITY_DATABASE_DESCRIPTOR_MISMATCH',
    );
  } finally {
    if (fixture.writerDb.open) fixture.writerDb.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('disabled backup flag fails closed before any source handle is opened', async () => {
  const fixture = createFixture();
  const expected = expectedEnvironment(fixture.dbPath);
  const env = { ...frozenEnvironment(fixture.dbPath), SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED: 'false' };
  let openCalls = 0;
  try {
    assert.throws(
      () => openVerifiedReadOnlyDatabase({ dbPath: fixture.dbPath, expectedEnvironment: expected, env }),
      error => error?.code === 'PRE_COMPATIBILITY_BACKUP_CONSERVATION_REQUIRED',
    );
    const app = express();
    const router = express.Router();
    registerPreCompatibilityBackupRoute(router, {
      dbPath: fixture.dbPath,
      openSourceDatabase: () => { openCalls += 1; throw new Error('must not open'); },
      startupSourceIdentity: { dev: 'never', ino: 'never', realPath: fixture.dbPath },
      buildInfo: () => ({}),
      expectedEnvironment: expected,
      isBackupOnlyRuntime: () => true,
      env,
    });
    app.use('/api', router);
    await withServer(app, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/skytech-pre-compatibility-backup`, {
        method: 'POST',
        headers: {
          'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
          'X-Skytech-Pre-Compatibility-Backup-Nonce': '44444444-4444-4444-8444-444444444444',
        },
      });
      assert.equal(response.status, 404);
    });
    assert.equal(openCalls, 0);
    assert.equal(fs.existsSync(path.join(fixture.root, 'backups')), false);
  } finally {
    fixture.writerDb.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('startup inode replacement is rejected before an archive or receipt can publish', async () => {
  const fixture = createFixture();
  const expected = expectedEnvironment(fixture.dbPath);
  const env = frozenEnvironment(fixture.dbPath);
  let sourceProvider;
  try {
    fixture.writerDb.close();
    const retainedSource = openVerifiedReadOnlyDatabase({
      dbPath: fixture.dbPath,
      expectedEnvironment: expected,
      env,
    });
    sourceProvider = createExclusiveSourceProvider(retainedSource);
    const startupSourceIdentity = sourceProvider.sourceIdentity;
    const displacedPath = path.join(fixture.root, 'displaced.sqlite');
    fs.renameSync(fixture.dbPath, displacedPath);
    fs.copyFileSync(displacedPath, fixture.dbPath, fs.constants.COPYFILE_EXCL);

    const app = express();
    const router = express.Router();
    registerPreCompatibilityBackupRoute(router, {
      dbPath: fixture.dbPath,
      openSourceDatabase: () => sourceProvider.acquire(),
      startupSourceIdentity,
      buildInfo: () => ({
        commit: env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7),
        commitFull: env.RAILWAY_GIT_COMMIT_SHA,
        startedAt: '2026-08-26T00:00:00.000Z',
        deployment: {
          railwayDeploymentId: env.RAILWAY_DEPLOYMENT_ID,
          railwayEnvironment: 'production',
          railwayService: 'rental-management',
          railwayReplicaId: env.RAILWAY_REPLICA_ID,
        },
      }),
      expectedEnvironment: expected,
      isBackupOnlyRuntime: () => true,
      env,
    });
    app.use('/api', router);
    await withServer(app, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/skytech-pre-compatibility-backup`, {
        method: 'POST',
        headers: {
          'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
          'X-Skytech-Pre-Compatibility-Backup-Nonce': '55555555-5555-4555-8555-555555555555',
        },
      });
      assert.equal(response.status, 409);
    });
    const outputs = fs.readdirSync(path.join(fixture.root, 'backups'));
    assert.ok(outputs.includes('.skytech-pre-compatibility-backup.lock.json'));
    assert.equal(outputs.some(name => name.endsWith('.zip')), false);
    assert.equal(outputs.includes('skytech-pre-compatibility-backup-receipt.json'), false);
  } finally {
    sourceProvider?.close();
    if (fixture.writerDb.open) fixture.writerDb.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a WAL commit during backup invalidates the attempt and removes the unpublished archive', async () => {
  const fixture = createFixture();
  const expected = expectedEnvironment(fixture.dbPath);
  const env = frozenEnvironment(fixture.dbPath);
  let concurrentWriterDb;
  let sourceProvider;
  try {
    fixture.writerDb.close();
    const retainedSource = openVerifiedReadOnlyDatabase({
      dbPath: fixture.dbPath,
      expectedEnvironment: expected,
      env,
    });
    sourceProvider = createExclusiveSourceProvider(retainedSource);
    const startupSourceIdentity = sourceProvider.sourceIdentity;
    concurrentWriterDb = new Database(fixture.dbPath);
    concurrentWriterDb.pragma('journal_mode = WAL');
    const backup = retainedSource.db.backup.bind(retainedSource.db);
    retainedSource.db.backup = async targetPath => {
      const result = await backup(targetPath);
      concurrentWriterDb.prepare("UPDATE app_data SET updated_at = ? WHERE name = 'users'")
        .run('2026-08-26T12:35:00.000Z');
      return result;
    };
    const app = express();
    const router = express.Router();
    registerPreCompatibilityBackupRoute(router, {
      dbPath: fixture.dbPath,
      openSourceDatabase: () => sourceProvider.acquire(),
      startupSourceIdentity,
      buildInfo: () => ({
        commit: env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7),
        commitFull: env.RAILWAY_GIT_COMMIT_SHA,
        startedAt: '2026-08-26T00:00:00.000Z',
        deployment: {
          railwayDeploymentId: env.RAILWAY_DEPLOYMENT_ID,
          railwayEnvironment: 'production',
          railwayService: 'rental-management',
          railwayReplicaId: env.RAILWAY_REPLICA_ID,
        },
      }),
      expectedEnvironment: expected,
      isBackupOnlyRuntime: () => true,
      env,
      now: () => new Date('2026-08-26T12:34:56.000Z'),
      randomUUID: () => '66666666-6666-4666-8666-666666666666',
    });
    app.use('/api', router);
    await withServer(app, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/skytech-pre-compatibility-backup`, {
        method: 'POST',
        headers: {
          'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
          'X-Skytech-Pre-Compatibility-Backup-Nonce': '77777777-7777-4777-8777-777777777777',
        },
      });
      assert.equal(response.status, 409);
    });
    const outputs = fs.readdirSync(path.join(fixture.root, 'backups'));
    assert.ok(outputs.includes('.skytech-pre-compatibility-backup.lock.json'));
    assert.equal(outputs.some(name => name.endsWith('.zip')), false);
    assert.equal(outputs.includes('skytech-pre-compatibility-backup-receipt.json'), false);
  } finally {
    if (concurrentWriterDb?.open) concurrentWriterDb.close();
    sourceProvider?.close();
    if (fixture.writerDb.open) fixture.writerDb.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a WAL commit after the read snapshot is pinned cannot be hidden in the initial fingerprint', async () => {
  const fixture = createFixture();
  const expected = expectedEnvironment(fixture.dbPath);
  const env = frozenEnvironment(fixture.dbPath);
  let concurrentWriterDb;
  let sourceProvider;
  try {
    fixture.writerDb.close();
    const retainedSource = openVerifiedReadOnlyDatabase({
      dbPath: fixture.dbPath,
      expectedEnvironment: expected,
      env,
    });
    sourceProvider = createExclusiveSourceProvider(retainedSource);
    const startupSourceIdentity = sourceProvider.sourceIdentity;
    concurrentWriterDb = new Database(fixture.dbPath);
    concurrentWriterDb.pragma('journal_mode = WAL');
    const prepare = retainedSource.db.prepare.bind(retainedSource.db);
    let injected = false;
    retainedSource.db.prepare = sql => {
      const statement = prepare(sql);
      if (!injected && /SELECT COUNT\(\*\) AS count FROM sqlite_master/.test(sql)) {
        const get = statement.get.bind(statement);
        statement.get = (...args) => {
          const result = get(...args);
          concurrentWriterDb.prepare("UPDATE app_data SET updated_at = ? WHERE name = 'users'")
            .run('2026-08-26T12:34:59.000Z');
          injected = true;
          return result;
        };
      }
      return statement;
    };
    const app = express();
    const router = express.Router();
    registerPreCompatibilityBackupRoute(router, {
      dbPath: fixture.dbPath,
      openSourceDatabase: () => sourceProvider.acquire(),
      startupSourceIdentity,
      buildInfo: () => ({
        commit: env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7),
        commitFull: env.RAILWAY_GIT_COMMIT_SHA,
        startedAt: '2026-08-26T00:00:00.000Z',
        deployment: {
          railwayDeploymentId: env.RAILWAY_DEPLOYMENT_ID,
          railwayEnvironment: 'production',
          railwayService: 'rental-management',
          railwayReplicaId: env.RAILWAY_REPLICA_ID,
        },
      }),
      expectedEnvironment: expected,
      isBackupOnlyRuntime: () => true,
      env,
      now: () => new Date('2026-08-26T12:34:56.000Z'),
      randomUUID: () => '88888888-8888-4888-8888-888888888888',
    });
    app.use('/api', router);
    await withServer(app, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/skytech-pre-compatibility-backup`, {
        method: 'POST',
        headers: {
          'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
          'X-Skytech-Pre-Compatibility-Backup-Nonce': '99999999-9999-4999-8999-999999999999',
        },
      });
      assert.equal(response.status, 409);
    });
    const outputs = fs.readdirSync(path.join(fixture.root, 'backups'));
    assert.ok(outputs.includes('.skytech-pre-compatibility-backup.lock.json'));
    assert.equal(outputs.some(name => name.endsWith('.zip')), false);
    assert.equal(outputs.includes('skytech-pre-compatibility-backup-receipt.json'), false);
  } finally {
    if (concurrentWriterDb?.open) concurrentWriterDb.close();
    sourceProvider?.close();
    if (fixture.writerDb.open) fixture.writerDb.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a WAL commit triggered by the final total_changes query is caught before receipt publication', async () => {
  const fixture = createFixture();
  const expected = expectedEnvironment(fixture.dbPath);
  const env = frozenEnvironment(fixture.dbPath);
  let concurrentWriterDb;
  let sourceProvider;
  try {
    fixture.writerDb.close();
    const retainedSource = openVerifiedReadOnlyDatabase({
      dbPath: fixture.dbPath,
      expectedEnvironment: expected,
      env,
    });
    sourceProvider = createExclusiveSourceProvider(retainedSource);
    concurrentWriterDb = new Database(fixture.dbPath);
    concurrentWriterDb.pragma('journal_mode = WAL');
    const prepare = retainedSource.db.prepare.bind(retainedSource.db);
    let totalChangesQueries = 0;
    retainedSource.db.prepare = sql => {
      const statement = prepare(sql);
      if (/SELECT total_changes\(\) AS count/.test(sql) && ++totalChangesQueries === 2) {
        const get = statement.get.bind(statement);
        statement.get = (...args) => {
          const result = get(...args);
          concurrentWriterDb.prepare("UPDATE app_data SET updated_at = ? WHERE name = 'users'")
            .run('2026-08-26T12:36:00.000Z');
          return result;
        };
      }
      return statement;
    };
    const app = express();
    const router = express.Router();
    registerPreCompatibilityBackupRoute(router, {
      dbPath: fixture.dbPath,
      openSourceDatabase: () => sourceProvider.acquire(),
      startupSourceIdentity: sourceProvider.sourceIdentity,
      buildInfo: () => ({
        commit: env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7),
        commitFull: env.RAILWAY_GIT_COMMIT_SHA,
        startedAt: '2026-08-26T00:00:00.000Z',
        deployment: {
          railwayDeploymentId: env.RAILWAY_DEPLOYMENT_ID,
          railwayEnvironment: 'production',
          railwayService: 'rental-management',
          railwayReplicaId: env.RAILWAY_REPLICA_ID,
        },
      }),
      expectedEnvironment: expected,
      isBackupOnlyRuntime: () => true,
      env,
      now: () => new Date('2026-08-26T12:34:56.000Z'),
      randomUUID: () => '12121212-1212-4212-8212-121212121212',
    });
    app.use('/api', router);
    await withServer(app, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/skytech-pre-compatibility-backup`, {
        method: 'POST',
        headers: {
          'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
          'X-Skytech-Pre-Compatibility-Backup-Nonce': '13131313-1313-4313-8313-131313131313',
        },
      });
      assert.equal(response.status, 409);
    });
    assert.equal(totalChangesQueries, 2);
    const outputs = fs.readdirSync(path.join(fixture.root, 'backups'));
    assert.ok(outputs.includes('.skytech-pre-compatibility-backup.lock.json'));
    assert.equal(outputs.some(name => name.endsWith('.zip')), false);
    assert.equal(outputs.includes('skytech-pre-compatibility-backup-receipt.json'), false);
  } finally {
    if (concurrentWriterDb?.open) concurrentWriterDb.close();
    sourceProvider?.close();
    if (fixture.writerDb.open) fixture.writerDb.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('backup coordinator runs work out of process, survives polling, and creates a fresh terminal invocation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-compatibility-worker-'));
  const workerPath = path.join(root, 'worker.cjs');
  fs.writeFileSync(workerPath, `'use strict';
process.once('message', message => {
  setTimeout(() => {
    process.send({
      protocol: message.protocol,
      invocationId: message.invocationId,
      statusCode: 200,
      body: {
        ok: true,
        idempotent: true,
        backup: { requestNonce: message.requestNonce },
      },
    }, () => process.disconnect());
  }, 150);
});
`);
  const invocationIds = [
    '14141414-1414-4414-8414-141414141414',
    '15151515-1515-4515-8515-151515151515',
  ];
  const coordinator = createPreCompatibilityBackupCoordinator({
    runtime: { startedAt: '2026-08-26T00:00:00.000Z' },
    startupSourceIdentity: { dev: '1', ino: '2', realPath: '/data/app.sqlite' },
    workerPath,
    workerTimeoutMs: 60_000,
    randomUUID: () => invocationIds.shift(),
  });
  const requestNonce = '16161616-1616-4616-8616-161616161616';
  try {
    let eventLoopProgressed = false;
    setTimeout(() => { eventLoopProgressed = true; }, 10);
    const startedAt = Date.now();
    const first = coordinator.start(requestNonce);
    assert.equal(first.status, 'RUNNING');
    assert.equal(first.reused, false);
    assert.ok(Date.now() - startedAt < 1_000);
    const retryWhileRunning = coordinator.start(requestNonce);
    assert.equal(retryWhileRunning.reused, true);
    assert.equal(retryWhileRunning.invocationId, first.invocationId);
    const firstComplete = await waitForCoordinatorStatus(coordinator, {
      requestNonce,
      invocationId: first.invocationId,
    }, 'COMPLETE');
    assert.equal(eventLoopProgressed, true);
    assert.equal(firstComplete.body.backup.requestNonce, requestNonce);

    const terminal = coordinator.start(requestNonce);
    assert.equal(terminal.status, 'RUNNING');
    assert.notEqual(terminal.invocationId, first.invocationId);
    const terminalComplete = await waitForCoordinatorStatus(coordinator, {
      requestNonce,
      invocationId: terminal.invocationId,
    }, 'COMPLETE');
    assert.equal(terminalComplete.body.idempotent, true);
  } finally {
    coordinator.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('backup coordinator converts a child crash into a terminal fail-closed status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-compatibility-worker-crash-'));
  const workerPath = path.join(root, 'worker.cjs');
  fs.writeFileSync(workerPath, `'use strict';
process.once('message', () => process.exit(2));
`);
  const coordinator = createPreCompatibilityBackupCoordinator({
    runtime: { startedAt: '2026-08-26T00:00:00.000Z' },
    startupSourceIdentity: { dev: '1', ino: '2', realPath: '/data/app.sqlite' },
    workerPath,
    workerTimeoutMs: 60_000,
    randomUUID: () => '17171717-1717-4717-8717-171717171717',
  });
  const identity = {
    requestNonce: '18181818-1818-4818-8818-181818181818',
    invocationId: '17171717-1717-4717-8717-171717171717',
  };
  try {
    coordinator.start(identity.requestNonce);
    const failed = await waitForCoordinatorStatus(coordinator, identity, 'FAILED');
    assert.equal(failed.statusCode, 409);
    assert.deepEqual(failed.body, { ok: false, error: 'Preliminary backup failed.' });
  } finally {
    coordinator.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('public backup control routes acknowledge quickly and keep status polling read-only', async () => {
  const fixture = createFixture();
  const expected = expectedEnvironment(fixture.dbPath);
  const env = frozenEnvironment(fixture.dbPath);
  const requestNonce = '19191919-1919-4919-8919-191919191919';
  const invocationId = '20202020-2020-4020-8020-202020202020';
  let state = 'RUNNING';
  const coordinator = {
    start(nonce) {
      assert.equal(nonce, requestNonce);
      return { invocationId, requestNonce, status: 'RUNNING', reused: false };
    },
    status(identity) {
      if (identity.requestNonce !== requestNonce || identity.invocationId !== invocationId) return null;
      if (state === 'RUNNING') return { ...identity, status: 'RUNNING', statusCode: 202, body: null };
      return {
        ...identity,
        status: 'COMPLETE',
        statusCode: 201,
        body: { ok: true, idempotent: false, backup: { requestNonce } },
      };
    },
  };
  try {
    const app = express();
    app.get('/health', (_req, res) => res.json({ ok: true }));
    const router = express.Router();
    registerPreCompatibilityBackupControlRoutes(router, {
      coordinator,
      dbPath: fixture.dbPath,
      startupSourceIdentity: { dev: 'unused', ino: 'unused', realPath: fixture.dbPath },
      expectedEnvironment: expected,
      isBackupOnlyRuntime: () => true,
      env,
    });
    app.use('/api', router);
    await withServer(app, async baseUrl => {
      const headers = {
        'X-Skytech-Pre-Compatibility-Backup-Token': env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN,
        'X-Skytech-Pre-Compatibility-Backup-Nonce': requestNonce,
      };
      const startedAt = Date.now();
      const startResponse = await fetch(`${baseUrl}/api/admin/skytech-pre-compatibility-backup`, {
        method: 'POST',
        headers,
      });
      assert.equal(startResponse.status, 202);
      assert.ok(Date.now() - startedAt < 1_000);
      assert.equal((await startResponse.json()).invocationId, invocationId);
      assert.equal((await fetch(`${baseUrl}/health`)).status, 200);

      const missingInvocation = await fetch(`${baseUrl}/api/admin/skytech-pre-compatibility-backup/status`, { headers });
      assert.equal(missingInvocation.status, 403);
      const statusHeaders = {
        ...headers,
        'X-Skytech-Pre-Compatibility-Backup-Invocation-Id': invocationId,
      };
      const running = await fetch(`${baseUrl}/api/admin/skytech-pre-compatibility-backup/status`, { headers: statusHeaders });
      assert.equal(running.status, 202);
      assert.equal((await running.json()).status, 'RUNNING');
      state = 'COMPLETE';
      const complete = await fetch(`${baseUrl}/api/admin/skytech-pre-compatibility-backup/status`, { headers: statusHeaders });
      assert.equal(complete.status, 200);
      const completeBody = await complete.json();
      assert.equal(completeBody.invocationId, invocationId);
      assert.equal(completeBody.workerStatusCode, 201);
    });
  } finally {
    fixture.writerDb.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('Railway wrapper selects the isolated server only for the raw exact enable flag', () => {
  assert.equal(resolveServerEntry({}), 'server.js');
  assert.equal(resolveServerEntry({ SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED: ' true' }), 'server.js');
  assert.equal(resolveServerEntry({ SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED: 'true' }), 'pre-compatibility-backup-server.js');
});

test('backup-only production server exposes only async control routes backed by the isolated worker', () => {
  const serverSource = fs.readFileSync(new URL('../server/pre-compatibility-backup-server.js', import.meta.url), 'utf8');
  const coordinatorSource = fs.readFileSync(new URL('../server/lib/pre-compatibility-backup-coordinator.js', import.meta.url), 'utf8');
  const workerSource = fs.readFileSync(new URL('../server/pre-compatibility-backup-worker.js', import.meta.url), 'utf8');
  assert.match(serverSource, /registerPreCompatibilityBackupControlRoutes\(router/);
  assert.doesNotMatch(serverSource, /registerPreCompatibilityBackupRoute\(router/);
  assert.match(coordinatorSource, /fork\(filename, \[\], options\)/);
  assert.match(coordinatorSource, /stdio: \['ignore', 'ignore', 'inherit', 'ipc'\]/);
  assert.doesNotMatch(coordinatorSource, /\bshell\s*:/);
  assert.match(coordinatorSource, /DEFAULT_WORKER_TIMEOUT_MS = 75 \* 60 \* 1000/);
  assert.match(workerSource, /openExactReadOnlyDatabase\(\)/);
  assert.match(workerSource, /executePreCompatibilityBackup\(/);
  assert.match(workerSource, /buildInfo: \(\) => runtime/);
  assert.match(workerSource, /if \(!resultDeliveryComplete\) process\.exit\(1\)/);
});

test('preliminary workflow is identity-pinned, secret-isolated, and revalidates the stored encrypted copy', () => {
  const workflow = fs.readFileSync(
    new URL('../.github/workflows/skytech-clean-production-reset.yml', import.meta.url),
    'utf8',
  );
  const deployWorkflow = fs.readFileSync(
    new URL('../.github/workflows/deploy.yml', import.meta.url),
    'utf8',
  );
  const remediationWorkflow = fs.readFileSync(
    new URL('../.github/workflows/production-scope-remediation.yml', import.meta.url),
    'utf8',
  );
  const namedSteps = workflow.split(/^      - name: /m).slice(1);
  const step = name => {
    const found = namedSteps.find(candidate => candidate.startsWith(name));
    assert.ok(found, `missing workflow step: ${name}`);
    return found;
  };

  assert.match(workflow, /expected_deployed_sha:[\s\S]*required: true/);
  assert.match(workflow, /timeout-minutes: 240/);
  assert.match(workflow, /concurrency:[\s\S]*group: production-release/);
  assert.match(deployWorkflow, /concurrency:[\s\S]*group: production-release/);
  assert.match(remediationWorkflow, /concurrency:[\s\S]*group: production-release/);
  assert.match(workflow, /EXPECTED_REPOSITORY: rishatkznAI\/rental-management/);
  assert.match(workflow, /EXPECTED_REF: refs\/heads\/main/);
  assert.match(workflow, /test "\$GITHUB_REPOSITORY" = "\$EXPECTED_REPOSITORY"/);
  assert.match(workflow, /test "\$GITHUB_REF" = "\$EXPECTED_REF"/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$EXPECTED_DEPLOYED_SHA"/);
  assert.match(workflow, /test "\$GITHUB_WORKFLOW_SHA" = "\$GITHUB_SHA"/);
  assert.match(workflow, /GITHUB_WORKFLOW_REF/);
  assert.match(workflow, /actions\/checkout@1af3b93b6815bc44a9784bd300feb67ff0d1eeb3/);
  assert.match(workflow, /actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f/);
  assert.match(workflow, /actions\/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53/);
  assert.doesNotMatch(workflow, /uses:\s+actions\/(?:checkout|upload-artifact|download-artifact)@v\d/);

  const nonceStep = step('Verify the checked-out commit and create the idempotency nonce');
  assert.match(nonceStep, /process\.env\.GITHUB_REPOSITORY[\s\S]*process\.env\.GITHUB_RUN_ID[\s\S]*process\.env\.EXPECTED_DEPLOYED_SHA/);
  assert.doesNotMatch(nonceStep, /GITHUB_RUN_ATTEMPT/);
  assert.match(nonceStep, /mode: 0o600, flag: 'wx'/);
  assert.match(nonceStep, /hexadecimal\[12\] = '4'/);
  assert.match(workflow, /X-Skytech-Pre-Compatibility-Backup-Nonce/);
  assert.match(workflow, /--header "@\$protected_headers"/);
  assert.doesNotMatch(workflow, /--header\s+["']X-Skytech-Pre-Compatibility-Backup-Token:/);

  assert.match(workflow, /SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN/);
  assert.match(workflow, /\/api\/admin\/skytech-pre-compatibility-backup/);
  assert.doesNotMatch(workflow, /inputs\.mode|X-Skytech-Reset-Token/);
  assert.doesNotMatch(workflow, /\/api\/admin\/skytech-clean-reset\/(?:dry-run|apply|verify|purge-quarantine)/);
  assert.equal((workflow.match(/identity\.activeDeployments\.length !== 1/g) || []).length, 2);
  assert.equal((workflow.match(/environment\(id: \$environmentId\)/g) || []).length, 2);
  assert.equal((workflow.match(/environmentStagedChanges\(environmentId: \$environmentId\)/g) || []).length, 2);
  assert.equal((workflow.match(/config\(decryptVariables: false\)/g) || []).length, 2);
  assert.equal((workflow.match(/patch\(decryptVariables: false\)/g) || []).length, 2);
  assert.doesNotMatch(workflow, /environment\.unmergedChangesCount === null/);
  assert.doesNotMatch(workflow, /acceptedEmptyRepresentations|numeric-zero/);
  assert.equal((workflow.match(/environment\.unmergedChangesCount === 0/g) || []).length, 2);
  assert.equal((workflow.match(/deploymentMetadataReplicaCount === 1/g) || []).length, 2);
  assert.equal((workflow.match(/effectiveConfigDesiredReplicaCount === 1/g) || []).length, 2);
  assert.equal((workflow.match(/latestDeployment\.instances \| length\) == 1/g) || []).length, 2);
  assert.equal((workflow.match(/select\(\.status != "RUNNING"\)/g) || []).length >= 4, true);
  assert.equal((workflow.match(/\$services\[0\]\.latestDeployment\.id == \$controlPlane\.activeDeploymentId/g) || []).length, 2);
  assert.match(workflow, /\.build\.deployment\.railwayReplicaId == \$railway\.replicaId/);
  assert.match(workflow, /\.appVersion\.deployment\.railwayReplicaId == \$receipt\.runtime\.replicaId/);
  assert.match(workflow, /\.appVersion\.startedAt == \$apiRuntime\.startedAt/);
  assert.match(workflow, /\.appVersion\.startedAt == \$receipt\.runtime\.startedAt/);
  assert.match(workflow, /receiptFilename == "skytech-pre-compatibility-backup-receipt\.json"/);
  assert.match(workflow, /\.source\.durableStateUnchanged == true/);
  assert.match(workflow, /\.source\.before\.database == \.source\.after\.database/);
  assert.match(workflow, /\.source\.before\.wal == \.source\.after\.wal/);

  const railwayBeforeStep = step('Prove one exact active Railway deployment and one running replica before backup');
  const railwayAfterStep = step('Re-prove the full Railway singleton predicate after stored-artifact verification');
  for (const railwayProofStep of [railwayBeforeStep, railwayAfterStep]) {
    assert.match(railwayProofStep, /environment\(id: \$environmentId\)[\s\S]*unmergedChangesCount[\s\S]*config\(decryptVariables: false\)[\s\S]*environmentStagedChanges\(environmentId: \$environmentId\)[\s\S]*patch\(decryptVariables: false\)/);
    assert.match(railwayProofStep, /environment\.id === process\.env\.RAILWAY_ENVIRONMENT_ID/);
    assert.match(railwayProofStep, /environment\.name === process\.env\.RAILWAY_ENVIRONMENT_NAME/);
    assert.match(railwayProofStep, /null is unknown, never evidence of an empty change set/);
    assert.match(railwayProofStep, /const stagedPatch = stagedChanges\.patch/);
    assert.match(railwayProofStep, /stagedPatchStructuralChangeCount = Object\.keys\(stagedPatch\)\.length/);
    assert.match(railwayProofStep, /stagedPatchStructuralChangeCount !== 0/);
    assert.match(railwayProofStep, /stagedPatchCanonical = JSON\.stringify\(stagedPatch\)/);
    assert.match(railwayProofStep, /stagedPatchCanonical !== '\{\}'/);
    assert.match(railwayProofStep, /stagedPatchFingerprint = crypto\.createHash\('sha256'\)[\s\S]*\.update\(stagedPatchCanonical\)/);
    assert.match(railwayProofStep, /effectiveServices\[process\.env\.RAILWAY_SERVICE_ID\]/);
    assert.match(railwayProofStep, /effectiveDeploy\.multiRegionConfig/);
    assert.match(railwayProofStep, /effectiveDeploy\.preDeployCommand === undefined/);
    assert.match(railwayProofStep, /effectiveDeployPreDeployCommandIsAbsent/);
    assert.match(railwayProofStep, /preDeployCommand: null/);
    assert.match(railwayProofStep, /effectiveSource\.repo === process\.env\.EXPECTED_REPOSITORY/);
    assert.match(railwayProofStep, /effectiveSource\.branch === process\.env\.RAILWAY_SOURCE_BRANCH/);
    assert.match(railwayProofStep, /effectiveSource\.rootDirectory === process\.env\.RAILWAY_SOURCE_ROOT_DIRECTORY/);
    assert.match(railwayProofStep, /effectiveVolumeMountIds\.length === 1/);
    assert.match(railwayProofStep, /effectiveVolumeMountIds\[0\] === process\.env\.RAILWAY_VOLUME_ID/);
    assert.match(railwayProofStep, /effectiveVolumeMount\.mountPath === process\.env\.RAILWAY_VOLUME_MOUNT_PATH/);
    assert.match(railwayProofStep, /effectiveConfigFingerprint = crypto\.createHash\('sha256'\)[\s\S]*JSON\.stringify\(effectiveConfigProjection\)/);
    assert.match(railwayProofStep, /deploymentMetadataReplicaCount,[\s\S]*effectiveConfigDesiredReplicaCount,[\s\S]*effectiveConfigProjection,[\s\S]*effectiveConfigFingerprint,[\s\S]*stagedChangesEmpty: true,[\s\S]*stagedPatchStructuralChangeCount,[\s\S]*stagedPatchFingerprint/);
    assert.doesNotMatch(railwayProofStep, /config\(decryptVariables: true\)/);
    assert.doesNotMatch(railwayProofStep, /patch\(decryptVariables: true\)/);
    assert.doesNotMatch(railwayProofStep, /console\.(?:log|dir|table)/);
    assert.doesNotMatch(railwayProofStep, /\bstagedPatch\s*[,}]/);
    assert.doesNotMatch(railwayProofStep, /\bstagedChanges\s*[,}]/);
    assert.doesNotMatch(
      railwayProofStep,
      /JSON\.stringify\((?:data|environment|effectiveEnvironmentConfig|effectiveServices|effectiveServiceConfig|effectiveSource|effectiveDeploy|effectiveMultiRegionConfig|effectiveVolumeMounts)\b/,
    );
  }
  assert.match(workflow, /RAILWAY_ENVIRONMENT_NAME: production/);
  assert.match(workflow, /RAILWAY_SOURCE_BRANCH: main/);
  assert.match(workflow, /RAILWAY_SOURCE_ROOT_DIRECTORY: \/server/);
  assert.match(workflow, /RAILWAY_CONFIG_FILE: \/server\/railway\.toml/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_PATH: \/health/);
  assert.match(workflow, /RAILWAY_START_COMMAND: node scripts\/start-with-release-type\.cjs/);
  assert.equal((workflow.match(/const effectiveRuntime = validateRailwayEffectiveConfig/g) || []).length, 2);
  assert.equal((workflow.match(/effectiveSourceCommitSha === process\.env\.EXPECTED_DEPLOYED_SHA/g) || []).length, 2);
  assert.equal((workflow.match(/volumeAttachmentCount:/g) || []).length, 2);
  assert.match(workflow, /\.railwayIdentityBefore\.volumeAttachmentCount == 1/);
  assert.match(workflow, /cmp --silent railway-control-plane-before\.json railway-control-plane-after\.json/);
  assert.match(workflow, /cmp --silent railway-target-before\.json railway-target-after\.json/);
  assert.equal((workflow.match(/\$controlPlane\.stagedChangesEmpty == true/g) || []).length, 2);
  assert.equal((workflow.match(/\$controlPlane\.stagedPatchStructuralChangeCount == 0/g) || []).length, 2);

  const invokeStep = step('Invoke the guarded idempotent preliminary backup');
  const railwayDownloadStep = step('Download and verify the plaintext backup and durable receipt from Railway');
  const encryptionStep = step('Encrypt the verified Railway download without Railway credentials');
  const digestStep = step('Enforce the uploaded artifact archive digest independently');
  const storedValidationStep = step('Decrypt and revalidate the freshly downloaded stored artifact');
  const terminalRecheckStep = step('Terminally recheck same-nonce idempotency after every stored-copy predicate');
  assert.match(invokeStep, /PRELIMINARY_BACKUP_TOKEN/);
  assert.doesNotMatch(invokeStep, /RAILWAY_TOKEN|BACKUP_ENCRYPTION_PASSPHRASE/);
  assert.match(railwayDownloadStep, /RAILWAY_TOKEN/);
  assert.doesNotMatch(railwayDownloadStep, /PRELIMINARY_BACKUP_TOKEN|BACKUP_ENCRYPTION_PASSPHRASE|\bgpg\b/);
  assert.match(encryptionStep, /BACKUP_ENCRYPTION_PASSPHRASE/);
  assert.doesNotMatch(encryptionStep, /RAILWAY_TOKEN|PRELIMINARY_BACKUP_TOKEN/);
  assert.match(digestStep, /GITHUB_TOKEN/);
  assert.match(digestStep, /computedDigest !== expectedDigest/);
  assert.doesNotMatch(digestStep, /RAILWAY_TOKEN|PRELIMINARY_BACKUP_TOKEN|BACKUP_ENCRYPTION_PASSPHRASE/);
  assert.match(storedValidationStep, /BACKUP_ENCRYPTION_PASSPHRASE/);
  assert.doesNotMatch(storedValidationStep, /GITHUB_TOKEN|RAILWAY_TOKEN|PRELIMINARY_BACKUP_TOKEN/);
  assert.match(terminalRecheckStep, /PRELIMINARY_BACKUP_TOKEN/);
  assert.doesNotMatch(terminalRecheckStep, /RAILWAY_TOKEN|GITHUB_TOKEN|BACKUP_ENCRYPTION_PASSPHRASE|EXPECTED_DEPLOYED_SHA/);
  assert.match(terminalRecheckStep, /--header "@\$protected_headers"/);
  assert.match(terminalRecheckStep, /chmod 600 "\$protected_headers"/);
  assert.match(terminalRecheckStep, /--write-out '%\{http_code\}'/);
  assert.match(terminalRecheckStep, /test "\$http_status" = "200"/);
  assert.match(terminalRecheckStep, /test "\$start_http_status" = "202"/);
  assert.match(terminalRecheckStep, /--request GET/);
  assert.match(terminalRecheckStep, /pre-compatibility-backup\/status/);
  assert.match(terminalRecheckStep, /test "\$terminal_invocation_id" != "\$initial_invocation_id"/);
  assert.match(terminalRecheckStep, /distinctWorkerInvocations: \(\$initialInvocationId != \$terminalInvocationId\)/);
  assert.match(terminalRecheckStep, /\.idempotent == true/);
  assert.equal((terminalRecheckStep.match(/jq -cS '\.backup'/g) || []).length, 2);
  assert.match(terminalRecheckStep, /cmp --silent original-backup-object\.canonical\.json terminal-backup-object\.canonical\.json/);
  assert.match(terminalRecheckStep, /backupObjectByteEquivalent: true/);
  assert.doesNotMatch(terminalRecheckStep, /--header\s+["']X-Skytech-Pre-Compatibility-Backup-Token:/);
  assert.equal((workflow.match(/\/api\/admin\/skytech-pre-compatibility-backup/g) || []).length, 4);
  assert.equal((workflow.match(/\/api\/admin\/skytech-pre-compatibility-backup\/status/g) || []).length, 2);
  assert.doesNotMatch(workflow, /--max-time 3300/);
  assert.match(invokeStep, /test "\$start_http_status" = "202"/);
  assert.match(invokeStep, /poll_deadline="\$\(\(SECONDS \+ 4800\)\)"/);
  assert.match(invokeStep, /--request GET/);

  const uploadIndex = workflow.indexOf('Store encrypted preliminary off-volume backup');
  const removeIndex = workflow.indexOf('Remove the local upload source before retrieval testing');
  const downloadIndex = workflow.indexOf('Independently download the immutable artifact by exact ID');
  const digestIndex = workflow.indexOf('Enforce the uploaded artifact archive digest independently');
  const storedValidationIndex = workflow.indexOf('Decrypt and revalidate the freshly downloaded stored artifact');
  const afterPredicateIndex = workflow.indexOf('Re-prove the full Railway singleton predicate after stored-artifact verification');
  const afterApiPredicateIndex = workflow.indexOf('Re-prove the complete API runtime and replica predicate after artifact verification');
  const terminalRecheckIndex = workflow.indexOf('Terminally recheck same-nonce idempotency after every stored-copy predicate');
  const evidenceIndex = workflow.indexOf('Create exact stored-copy machine evidence');
  assert.ok(uploadIndex < removeIndex && removeIndex < downloadIndex && downloadIndex < digestIndex && digestIndex < storedValidationIndex);
  assert.ok(storedValidationIndex < terminalRecheckIndex);
  assert.ok(terminalRecheckIndex < afterPredicateIndex && afterPredicateIndex < afterApiPredicateIndex && afterApiPredicateIndex < evidenceIndex);
  assert.match(workflow, /artifact-ids: \$\{\{ steps\.backup_artifact\.outputs\.artifact-id \}\}/);
  assert.match(workflow, /rm -f skytech-clean-reset-backup\.zip\.gpg[\s\S]*test ! -e skytech-clean-reset-backup\.zip\.gpg/);
  assert.match(workflow, /unzip -p "\$digest_verified_dir\/verified-backup\.zip" database\/app\.sqlite/);
  assert.match(workflow, /sqlite3 -readonly "\$digest_verified_dir\/verified-backup\.sqlite" 'PRAGMA integrity_check;'/);
  assert.match(workflow, /sqlite3 -readonly "\$digest_verified_dir\/verified-backup\.sqlite" 'PRAGMA foreign_key_check;'/);
  assert.match(workflow, /runAttempt: \$runAttempt/);
  assert.match(workflow, /railwayMutationFreezeClaimed: false/);
  assert.match(workflow, /does not freeze[\s\S]*Railway's external control plane/);
  assert.match(workflow, /railwayNullableUnmergedCountAccepted: false/);
  assert.match(workflow, /railwayStagedPatchQueriedWithDecryptVariablesFalse: true/);
  assert.match(workflow, /railwayStagedPatchCanonicalEmptyBeforeAndAfter: true/);
  assert.match(workflow, /railwayStagedPatchContentsPersisted: false/);
  assert.match(workflow, /terminalConservationRecheck: \$terminalConservationRecheck/);
  assert.match(workflow, /performedAfterStoredArtifactBeforeFinalRailwayApiReproof: true/);
  assert.match(workflow, /sameNonceTerminalIdempotencyRecheck: true/);
  assert.match(workflow, /terminalBackupObjectByteEquivalent: true/);
  assert.match(workflow, /\.apiRuntimeIdentityBefore\.startedAt == \.backupRuntimeIdentity\.startedAt/);
  assert.match(workflow, /\.receipt\.runtime\.startedAt == \.backupRuntimeIdentity\.startedAt/);
  assert.match(workflow, /\.terminalConservationRecheck\.distinctWorkerInvocations == true/);
  assert.match(workflow, /terminal-idempotency-response\.json/);
  assert.match(workflow, /terminal-conservation-validation\.json/);
  assert.match(workflow, /STORED_ARTIFACT_DOWNLOADED_DECRYPTED_AND_REVALIDATED/);
  assert.match(workflow, /path: skytech-clean-reset-backup\.zip\.gpg/);
  assert.doesNotMatch(workflow, /^\s*path:\s*skytech-clean-reset-backup\.zip\s*$/m);
});
