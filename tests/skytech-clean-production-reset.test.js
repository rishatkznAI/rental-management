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
const { buildZipArchive } = require('../server/lib/zip-store.js');
const { inspectStoredZipArchive } = require('../server/lib/full-backup-validation.js');
const {
  DELETED_COLLECTIONS,
  ISOLATED_CONFIRMATION,
  PRODUCTION_CONFIRMATION,
  PURGE_CONFIRMATION,
  RETAINED_COLLECTIONS,
  applyReset,
  assertProductionConservation,
  buildResetPlan,
  fileSha256,
  purgeQuarantine,
  retentionSnapshot,
} = require('../server/lib/skytech-clean-production-reset.js');
const {
  ALL_APP_DATA_COLLECTIONS,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
} = require('../server/lib/app-data-scope-registry.js');
const {
  backupTimestamp,
  registerSkytechCleanResetRoutes,
  safeBackupPath,
  safeQuarantinePath,
} = require('../server/routes/skytech-clean-reset.js');
const {
  registerPreCompatibilityBackupRoute,
} = require('../server/routes/pre-compatibility-backup.js');
const {
  assertEnvironmentGuard,
} = require('../server/scripts/skytech-clean-production-reset.js');
const {
  assertPreCompatibilityBackupEnvironment,
} = require('../server/lib/pre-compatibility-backup.js');
const {
  openVerifiedReadOnlyDatabase,
} = require('../server/pre-compatibility-backup-server.js');

const PRODUCTION_CONSERVATION = Object.freeze({
  appDisabled: true,
  botDisabled: true,
  gsmDisabled: true,
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skytech-clean-reset-test-'));
  const dbPath = path.join(root, 'app.sqlite');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
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
  `);
  const insertCollection = db.prepare('INSERT INTO app_data(name, json, updated_at) VALUES (?, ?, ?)');
  const unchangedAt = '2026-08-18T00:00:00.000Z';
  const collections = {
    users: [{ id: 'U-1', email: 'admin@example.test', passwordHash: 'sealed-hash', role: 'Администратор', status: 'Активен' }],
    app_settings: [],
    bot_users: { 'max-1': { id: 'max-1', userId: 'U-1', role: 'Администратор' } },
    knowledge_base_modules: [{ id: 'KB-1', title: 'Системный справочник' }],
    service_works: [{ id: 'SW-1', name: 'Диагностика' }],
    spare_parts: [{ id: 'SP-1', name: 'Фильтр' }],
    service_route_norms: [{ id: 'RN-1', km: 25 }],
    service_work_catalog: [],
    spare_parts_catalog: [{ id: 'SPC-1', name: 'Фильтр' }],
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', company: 'Старый клиент' }],
    counterparties: [{ id: 'CP-1', legalName: 'Старый клиент' }],
    equipment: [{ id: 'E-1', inventoryNumber: 'OLD-1' }],
    rentals: [{ id: 'R-1', clientId: 'C-1', equipmentId: 'E-1' }],
    gantt_rentals: [{ id: 'GR-1', rentalId: 'R-1' }],
    payments: [{ id: 'P-1', clientId: 'C-1', amount: 100 }],
    payment_allocations: [{ id: 'PA-1', paymentId: 'P-1', rentalId: 'R-1', amount: 100 }],
    documents: [{ id: 'D-1', clientId: 'C-1' }],
    service: [{ id: 'S-1', equipmentId: 'E-1' }],
    deliveries: [{ id: 'DL-1', rentalId: 'R-1' }],
    bot_sessions: { 'max-1': { scenario: 'old-rental' } },
    audit_logs: [{ id: 'A-1', entityType: 'clients', entityId: 'C-1' }],
    snapshot: { clients: 1, rentals: 1 },
  };
  for (const [name, value] of Object.entries(collections)) {
    insertCollection.run(name, JSON.stringify(value), unchangedAt);
  }
  db.prepare('INSERT INTO app_sessions VALUES (?, ?, ?)').run('session-hash', 'U-1', '2027-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO sql_shadow_schema_migrations VALUES (?, ?)').run(1, 'initial');
  db.prepare('INSERT INTO capability_catalog_versions VALUES (?, ?)').run(1, 'active');
  db.prepare('INSERT INTO capability_catalog_entries VALUES (?, ?)').run(1, 'clients.read');
  db.prepare('INSERT INTO client_inn_index VALUES (?, ?)').run('C-1', '1234567890');
  db.prepare('INSERT INTO documents_sql VALUES (?, ?)').run('D-1', 'C-1');

  const uploads = path.join(root, 'uploads');
  fs.mkdirSync(path.join(uploads, 'equipment'), { recursive: true });
  const photoPath = path.join(uploads, 'equipment', 'old-photo.jpg');
  fs.writeFileSync(photoPath, 'old-business-photo');
  const backupPath = path.join(root, 'verified-backup.zip');
  const collectionCounts = Object.fromEntries(
    db.prepare('SELECT name, json FROM app_data ORDER BY name').all()
      .map(row => [row.name, Array.isArray(JSON.parse(row.json))
        ? JSON.parse(row.json).length
        : Object.keys(JSON.parse(row.json) || {}).length]),
  );
  const manifest = {
    generatedAt: '2026-08-18T00:00:00.000Z',
    appName: 'Skytech Rental Management',
    database: { type: 'sqlite', includedAs: 'database/app.sqlite', sourcePath: 'app.sqlite' },
    counts: collectionCounts,
    includedFilesCount: 1,
    skippedFilesCount: 0,
    files: { includedFilesCount: 1, skippedFilesCount: 0 },
  };
  fs.writeFileSync(backupPath, buildZipArchive([
    { name: 'manifest.json', data: JSON.stringify(manifest) },
    { name: 'database/app.sqlite', data: fs.readFileSync(dbPath) },
    { name: 'files/uploads/equipment/old-photo.jpg', data: fs.readFileSync(photoPath) },
  ]));
  return { root, dbPath, db, uploads, backupPath, backupSha256: fileSha256(backupPath), collections };
}

function cleanupFixture(fixture) {
  try { fixture.db.close(); } catch { /* already closed */ }
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

async function withHttpServer(app, run) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('clean reset assigns one explicit disposition to every registry collection', () => {
  const retained = Object.keys(RETAINED_COLLECTIONS);
  const deleted = [...DELETED_COLLECTIONS];
  const dispositions = [...retained, ...deleted];
  assert.equal(dispositions.length, ALL_APP_DATA_COLLECTIONS.length);
  assert.equal(new Set(dispositions).size, dispositions.length);
  assert.deepEqual([...dispositions].sort(), [...ALL_APP_DATA_COLLECTIONS].sort());
  for (const catalogue of PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS) {
    assert.ok(RETAINED_COLLECTIONS[catalogue], catalogue);
  }
});

test('dry-run is read-only and reports exact deletion, retention and file impact', () => {
  const fixture = createFixture();
  try {
    const before = fs.readFileSync(fixture.dbPath);
    const retainedBefore = retentionSnapshot(fixture.db);
    const plan = buildResetPlan(fixture.db, { dbPath: fixture.dbPath });
    const after = fs.readFileSync(fixture.dbPath);

    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.deleteCollections.find(row => row.name === 'clients').count, 1);
    assert.equal(plan.deleteCollections.find(row => row.name === 'bot_sessions').type, 'object');
    assert.equal(plan.keepCollections.find(row => row.name === 'users').count, 1);
    assert.equal(plan.deleteTables.find(row => row.name === 'documents_sql').count, 1);
    assert.equal(plan.fileCleanup.find(row => row.root === fixture.uploads).files, 1);
    assert.deepEqual(after, before);
    assert.deepEqual(retentionSnapshot(fixture.db), retainedBefore);

    const second = buildResetPlan(fixture.db, { dbPath: fixture.dbPath });
    assert.deepEqual(second, plan);
  } finally {
    cleanupFixture(fixture);
  }
});

test('isolated apply removes business data and files while sealing identity, settings and schema', () => {
  const fixture = createFixture();
  try {
    const usersRaw = fixture.db.prepare("SELECT json, updated_at FROM app_data WHERE name = 'users'").get();
    const settingsRaw = fixture.db.prepare("SELECT json, updated_at FROM app_data WHERE name = 'app_settings'").get();
    const retainedBefore = retentionSnapshot(fixture.db);
    const result = applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'isolated',
      confirm: ISOLATED_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
    });

    assert.equal(result.after.deleteCollections.every(row => row.count === 0), true);
    assert.equal(result.after.deleteTables.every(row => row.count === 0), true);
    assert.equal(result.foreignKeyViolations, 0);
    assert.deepEqual(result.integrity, [{ integrity_check: 'ok' }]);
    assert.deepEqual(fixture.db.prepare("SELECT json, updated_at FROM app_data WHERE name = 'users'").get(), usersRaw);
    assert.deepEqual(fixture.db.prepare("SELECT json, updated_at FROM app_data WHERE name = 'app_settings'").get(), settingsRaw);
    assert.deepEqual(result.retentionBefore, retainedBefore);
    assert.deepEqual(result.retentionAfter, retainedBefore);
    assert.equal(JSON.parse(fixture.db.prepare("SELECT json FROM app_data WHERE name = 'bot_sessions'").get().json) instanceof Array, false);
    assert.deepEqual(JSON.parse(fixture.db.prepare("SELECT json FROM app_data WHERE name = 'bot_sessions'").get().json), {});
    assert.equal(fs.readdirSync(fixture.uploads).length, 0);
    assert.ok(result.fileCleanup.quarantinePath);

    const repeated = applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'isolated',
      confirm: ISOLATED_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
    });
    assert.equal(repeated.after.deleteCollections.every(row => row.count === 0), true);
    assert.equal(repeated.fileCleanup.quarantinePath, null);

    const purged = purgeQuarantine({
      dbPath: fixture.dbPath,
      quarantinePath: result.fileCleanup.quarantinePath,
      confirm: PURGE_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
    });
    assert.equal(purged.purged, true);
    assert.equal(fs.existsSync(result.fileCleanup.quarantinePath), false);
  } finally {
    cleanupFixture(fixture);
  }
});

test('database failure rolls back both JSON deletion and staged file cleanup', () => {
  const fixture = createFixture();
  try {
    fixture.db.exec(`
      DROP TRIGGER documents_sql_cleanup;
      CREATE TRIGGER documents_sql_append_only
      BEFORE DELETE ON documents_sql
      BEGIN
        SELECT RAISE(ABORT, 'documents_sql is append-only');
      END;
    `);
    const clientsBefore = fixture.db.prepare("SELECT json, updated_at FROM app_data WHERE name = 'clients'").get();
    const photoPath = path.join(fixture.uploads, 'equipment', 'old-photo.jpg');

    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'isolated',
      confirm: ISOLATED_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
    }), /documents_sql is append-only/);

    assert.deepEqual(
      fixture.db.prepare("SELECT json, updated_at FROM app_data WHERE name = 'clients'").get(),
      clientsBefore,
    );
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM documents_sql').get().count, 1);
    assert.equal(fs.readFileSync(photoPath, 'utf8'), 'old-business-photo');
    assert.equal(
      fs.readdirSync(fixture.root).some(name => name.startsWith('.skytech-reset-quarantine-')),
      false,
    );
  } finally {
    cleanupFixture(fixture);
  }
});

test('partial multi-root staging failure restores every file root before database mutation', () => {
  const fixture = createFixture();
  const photos = path.join(fixture.root, 'photos');
  fs.mkdirSync(photos);
  fs.writeFileSync(path.join(photos, 'old-service-photo.jpg'), 'old-service-photo');
  const originalRenameSync = fs.renameSync;
  let renameCalls = 0;
  try {
    fs.renameSync = (...args) => {
      renameCalls += 1;
      if (renameCalls === 2) throw new Error('simulated second-root staging failure');
      return originalRenameSync(...args);
    };

    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'isolated',
      confirm: ISOLATED_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
    }), /simulated second-root staging failure/);

    assert.equal(fs.readFileSync(path.join(fixture.uploads, 'equipment', 'old-photo.jpg'), 'utf8'), 'old-business-photo');
    assert.equal(fs.readFileSync(path.join(photos, 'old-service-photo.jpg'), 'utf8'), 'old-service-photo');
    assert.equal(JSON.parse(fixture.db.prepare("SELECT json FROM app_data WHERE name = 'clients'").get().json).length, 1);
    assert.equal(
      fs.readdirSync(fixture.root).some(name => name.startsWith('.skytech-reset-quarantine-')),
      false,
    );
  } finally {
    fs.renameSync = originalRenameSync;
    cleanupFixture(fixture);
  }
});

test('production apply is fail-closed without enable flag, audit, confirmation and verified backup', () => {
  const fixture = createFixture();
  const previousEnabled = process.env.SKYTECH_CLEAN_RESET_ENABLED;
  try {
    delete process.env.SKYTECH_CLEAN_RESET_ENABLED;
    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'production',
      conservationState: PRODUCTION_CONSERVATION,
      confirm: PRODUCTION_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
      preResetAudit: 'pass',
    }), /SKYTECH_CLEAN_RESET_ENABLED/);
    process.env.SKYTECH_CLEAN_RESET_ENABLED = 'true';
    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'production',
      conservationState: PRODUCTION_CONSERVATION,
      confirm: PRODUCTION_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
      preResetAudit: 'fail',
    }), /independent pre-reset audit PASS/);
    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'production',
      conservationState: PRODUCTION_CONSERVATION,
      confirm: 'wrong',
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
      preResetAudit: 'pass',
    }), /--confirm=/i);
    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'production',
      conservationState: PRODUCTION_CONSERVATION,
      confirm: PRODUCTION_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: '0'.repeat(64),
      preResetAudit: 'pass',
    }), /SHA-256/);
    const fakeBackupPath = path.join(fixture.root, 'not-a-backup.zip');
    fs.writeFileSync(fakeBackupPath, 'arbitrary text is not a full backup');
    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'production',
      conservationState: PRODUCTION_CONSERVATION,
      confirm: PRODUCTION_CONFIRMATION,
      backupPath: fakeBackupPath,
      backupSha256: fileSha256(fakeBackupPath),
      preResetAudit: 'pass',
    }), /not a ZIP archive|ZIP end record/);
    assert.equal(JSON.parse(fixture.db.prepare("SELECT json FROM app_data WHERE name = 'clients'").get().json).length, 1);
  } finally {
    if (previousEnabled === undefined) delete process.env.SKYTECH_CLEAN_RESET_ENABLED;
    else process.env.SKYTECH_CLEAN_RESET_ENABLED = previousEnabled;
    cleanupFixture(fixture);
  }
});

test('production apply rejects a valid full backup after database or file drift', () => {
  const fixture = createFixture();
  const previousEnabled = process.env.SKYTECH_CLEAN_RESET_ENABLED;
  try {
    process.env.SKYTECH_CLEAN_RESET_ENABLED = 'true';
    fixture.db.prepare("UPDATE app_data SET json = ? WHERE name = 'clients'").run(JSON.stringify([
      ...fixture.collections.clients,
      { id: 'C-LATE', counterpartyId: 'CP-LATE', company: 'Late write after backup' },
    ]));
    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'production',
      conservationState: PRODUCTION_CONSERVATION,
      confirm: PRODUCTION_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
      preResetAudit: 'pass',
    }), /does not exactly match the current reset source database/);

    fixture.db.prepare("UPDATE app_data SET json = ? WHERE name = 'clients'").run(JSON.stringify(fixture.collections.clients));
    fs.writeFileSync(path.join(fixture.uploads, 'equipment', 'old-photo.jpg'), 'changed-business-photo');
    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'production',
      conservationState: PRODUCTION_CONSERVATION,
      confirm: PRODUCTION_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
      preResetAudit: 'pass',
    }), /does not exactly cover current business file/);
  } finally {
    if (previousEnabled === undefined) delete process.env.SKYTECH_CLEAN_RESET_ENABLED;
    else process.env.SKYTECH_CLEAN_RESET_ENABLED = previousEnabled;
    cleanupFixture(fixture);
  }
});

test('production apply rejects a business-file payload corrupted behind unchanged ZIP metadata', () => {
  const fixture = createFixture();
  const previousEnabled = process.env.SKYTECH_CLEAN_RESET_ENABLED;
  const photoPath = path.join(fixture.uploads, 'equipment', 'old-photo.jpg');
  try {
    process.env.SKYTECH_CLEAN_RESET_ENABLED = 'true';
    const archive = inspectStoredZipArchive(fixture.backupPath);
    const entry = archive.entries.get('files/uploads/equipment/old-photo.jpg');
    assert.ok(entry);
    const fd = fs.openSync(fixture.backupPath, 'r+');
    try {
      const local = Buffer.alloc(30);
      assert.equal(fs.readSync(fd, local, 0, local.length, entry.localOffset), local.length);
      const nameLength = local.readUInt16LE(26);
      const extraLength = local.readUInt16LE(28);
      const payloadOffset = entry.localOffset + 30 + nameLength + extraLength;
      const byte = Buffer.alloc(1);
      assert.equal(fs.readSync(fd, byte, 0, 1, payloadOffset), 1);
      byte[0] ^= 0xff;
      assert.equal(fs.writeSync(fd, byte, 0, 1, payloadOffset), 1);
    } finally {
      fs.closeSync(fd);
    }

    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'production',
      conservationState: PRODUCTION_CONSERVATION,
      confirm: PRODUCTION_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fileSha256(fixture.backupPath),
      preResetAudit: 'pass',
    }), /failed CRC-32 validation/);
    assert.equal(JSON.parse(fixture.db.prepare("SELECT json FROM app_data WHERE name = 'clients'").get().json).length, 1);
    assert.equal(fs.readFileSync(photoPath, 'utf8'), 'old-business-photo');
    assert.equal(
      fs.readdirSync(fixture.root).some(name => name.startsWith('.skytech-reset-quarantine-')),
      false,
    );
  } finally {
    if (previousEnabled === undefined) delete process.env.SKYTECH_CLEAN_RESET_ENABLED;
    else process.env.SKYTECH_CLEAN_RESET_ENABLED = previousEnabled;
    cleanupFixture(fixture);
  }
});

test('unknown schema and retained local files block reset before mutation', () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare('INSERT INTO app_data(name, json) VALUES (?, ?)').run('future_business_domain', '[]');
    let plan = buildResetPlan(fixture.db, { dbPath: fixture.dbPath });
    assert.match(plan.blockers.join(';'), /Unknown app_data collections: future_business_domain/);
    fixture.db.prepare("DELETE FROM app_data WHERE name = 'future_business_domain'").run();
    fixture.db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run(JSON.stringify([
      { id: 'U-1', profilePhoto: '/uploads/users/u-1.png' },
    ]));
    plan = buildResetPlan(fixture.db, { dbPath: fixture.dbPath });
    assert.match(plan.blockers.join(';'), /Retained collections reference local files: users:/);
    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'isolated',
      confirm: ISOLATED_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
    }), /Reset preconditions failed/);
    assert.equal(JSON.parse(fixture.db.prepare("SELECT json FROM app_data WHERE name = 'clients'").get().json).length, 1);
  } finally {
    cleanupFixture(fixture);
  }
});

test('unsupported filesystem entries block reset instead of escaping the backup contract', () => {
  const fixture = createFixture();
  try {
    const symlink = path.join(fixture.uploads, 'external-link');
    fs.symlinkSync(fixture.backupPath, symlink);
    const plan = buildResetPlan(fixture.db, { dbPath: fixture.dbPath });

    assert.equal(plan.fileCleanup.find(row => row.root === fixture.uploads).unsupportedEntries, 1);
    assert.match(plan.blockers.join(';'), /Unsupported file entries in business roots/);
    assert.throws(() => applyReset(fixture.db, {
      dbPath: fixture.dbPath,
      environment: 'isolated',
      confirm: ISOLATED_CONFIRMATION,
      backupPath: fixture.backupPath,
      backupSha256: fixture.backupSha256,
    }), /Reset preconditions failed/);
  } finally {
    cleanupFixture(fixture);
  }
});

test('operation paths and UTC backup timestamp reject ambiguous targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skytech-reset-path-test-'));
  try {
    const dbPath = path.join(root, 'app.sqlite');
    assert.equal(backupTimestamp(new Date('2026-08-18T12:34:56.789Z')), '20260818T123456Z');
    assert.equal(
      safeBackupPath(dbPath, 'skytech-pre-clean-reset-20260818T123456Z.zip'),
      path.join(root, 'backups', 'skytech-pre-clean-reset-20260818T123456Z.zip'),
    );
    assert.throws(() => safeBackupPath(dbPath, '../backup.zip'), /Invalid reset backup filename/);
    assert.equal(
      safeQuarantinePath(dbPath, '.skytech-reset-quarantine-20260818T123456789Z'),
      path.join(root, '.skytech-reset-quarantine-20260818T123456789Z'),
    );
    assert.throws(() => safeQuarantinePath(dbPath, '../../uploads'), /Invalid reset quarantine name/);
    assert.throws(() => assertEnvironmentGuard({
      mode: 'apply',
      environment: 'isolated',
      dbPath: '/data/app.sqlite',
      env: {},
    }), /Isolated apply is forbidden/);
    assert.throws(() => assertEnvironmentGuard({
      mode: 'apply',
      environment: 'isolated',
      dbPath,
      env: { RAILWAY_ENVIRONMENT_NAME: 'production' },
    }), /Isolated apply is forbidden/);
    assert.doesNotThrow(() => assertEnvironmentGuard({
      mode: 'apply',
      environment: 'isolated',
      dbPath,
      env: {},
    }));
    assert.equal(crypto.createHash('sha256').update('x').digest('hex').length, 64);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production conservation guard requires app, bot and GSM writers all disabled', () => {
  assert.throws(() => assertProductionConservation({
    ...PRODUCTION_CONSERVATION,
    appDisabled: false,
  }), /APP_DISABLED/);
  assert.throws(() => assertProductionConservation({
    ...PRODUCTION_CONSERVATION,
    botDisabled: false,
  }), /BOT_DISABLED/);
  assert.throws(() => assertProductionConservation({
    ...PRODUCTION_CONSERVATION,
    gsmDisabled: false,
  }), /GSM_DISABLED/);
  assert.doesNotThrow(() => assertProductionConservation(PRODUCTION_CONSERVATION));
});

test('pre-compatibility backup startup gate requires exact freeze, target, runtime and backup-only secrets', () => {
  const expectedEnvironment = {
    projectId: 'project',
    environmentId: 'environment',
    serviceId: 'service',
    volumeName: 'volume',
    volumeMountPath: '/data',
    sourceDbPath: '/data/app.sqlite',
  };
  const env = {
    NODE_ENV: 'production',
    RAILWAY_PROJECT_ID: 'project',
    RAILWAY_ENVIRONMENT_ID: 'environment',
    RAILWAY_SERVICE_ID: 'service',
    RAILWAY_VOLUME_NAME: 'volume',
    RAILWAY_VOLUME_MOUNT_PATH: '/data',
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
  const options = { dbPath: '/data/app.sqlite', expectedEnvironment };
  assert.throws(
    () => assertPreCompatibilityBackupEnvironment({}, options),
    error => error?.code === 'PRE_COMPATIBILITY_BACKUP_CONSERVATION_REQUIRED',
  );
  assert.equal(assertPreCompatibilityBackupEnvironment(env, options), true);

  const unsafe = [
    ['NODE_ENV', 'staging'],
    ['RAILWAY_PROJECT_ID', 'other'],
    ['RAILWAY_ENVIRONMENT_ID', 'other'],
    ['RAILWAY_SERVICE_ID', 'other'],
    ['RAILWAY_VOLUME_NAME', 'other'],
    ['RAILWAY_VOLUME_MOUNT_PATH', '/tmp'],
    ['RAILWAY_REPLICA_ID', ''],
    ['RAILWAY_REPLICA_ID', ' replica'],
    ['RAILWAY_DEPLOYMENT_ID', ''],
    ['RAILWAY_DEPLOYMENT_ID', 'deployment '],
    ['RAILWAY_GIT_COMMIT_SHA', 'A'.repeat(40)],
    ['RAILWAY_GIT_COMMIT_SHA', ` ${'a'.repeat(40)}`],
    ['SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA', 'b'.repeat(40)],
    ['SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA', 'A'.repeat(40)],
    ['PRODUCTION_SCOPE_REMEDIATION_ENABLED', 'false'],
    ['PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE', 'false'],
    ['PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY', 'true'],
    ['PRODUCTION_SCOPE_REMEDIATION_VALIDATION_READ_ONLY', 'true'],
    ['PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES', ' '],
    ['PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE', 'verify'],
    ['PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET', ' '],
    ['APP_DISABLED', 'false'],
    ['BOT_DISABLED', 'false'],
    ['GSM_DISABLED', 'false'],
    ['GSM_ENABLED', 'true'],
    ['SKYTECH_CLEAN_RESET_ENABLED', 'true'],
    ['SKYTECH_CLEAN_RESET_TOKEN', ' '],
    ['SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN', 'short'],
    ['SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN', `${'b'.repeat(32)}\n`],
    ['ADMIN_RESET_PASSWORD', ' '],
  ];
  for (const [key, value] of unsafe) {
    assert.throws(
      () => assertPreCompatibilityBackupEnvironment({ ...env, [key]: value }, options),
      error => error?.code === 'PRE_COMPATIBILITY_BACKUP_CONSERVATION_REQUIRED',
      key,
    );
  }
  assert.throws(
    () => assertPreCompatibilityBackupEnvironment(env, { ...options, dbPath: '/tmp/app.sqlite' }),
    error => error?.code === 'PRE_COMPATIBILITY_BACKUP_CONSERVATION_REQUIRED',
  );
});

test('isolated preliminary runtime opens the exact source query-only and can create a coherent SQLite backup', async () => {
  const fixture = createFixture();
  const exactDbPath = fs.realpathSync(fixture.dbPath);
  const expectedRows = fixture.db.prepare('SELECT name, json FROM app_data ORDER BY name').all();
  fixture.db.close();
  const expectedEnvironment = {
    projectId: 'project',
    environmentId: 'environment',
    serviceId: 'service',
    volumeName: 'volume',
    volumeMountPath: path.dirname(exactDbPath),
    sourceDbPath: exactDbPath,
  };
  const env = {
    NODE_ENV: 'production',
    DB_PATH: exactDbPath,
    RAILWAY_PROJECT_ID: 'project',
    RAILWAY_ENVIRONMENT_ID: 'environment',
    RAILWAY_SERVICE_ID: 'service',
    RAILWAY_VOLUME_NAME: 'volume',
    RAILWAY_VOLUME_MOUNT_PATH: path.dirname(exactDbPath),
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
  let source;
  try {
    source = openVerifiedReadOnlyDatabase({
      dbPath: exactDbPath,
      expectedEnvironment,
      env,
    });
    assert.equal(source.db.pragma('query_only', { simple: true }), 1);
    assert.throws(
      () => source.db.prepare("UPDATE app_data SET json = '[]' WHERE name = 'users'").run(),
      /readonly|read-only/i,
    );
    const backupPath = path.join(fixture.root, 'isolated-backup.sqlite');
    await source.db.backup(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(backup.pragma('quick_check', { simple: true }), 'ok');
      assert.deepEqual(
        backup.prepare('SELECT name, json FROM app_data ORDER BY name').all(),
        expectedRows,
      );
    } finally {
      backup.close();
    }
  } finally {
    source?.close();
    cleanupFixture(fixture);
  }
});

test('operations route is hidden by default and requires its temporary secret for guarded apply', async () => {
  const fixture = createFixture();
  const previousEnabled = process.env.SKYTECH_CLEAN_RESET_ENABLED;
  const previousToken = process.env.SKYTECH_CLEAN_RESET_TOKEN;
  const token = 'unit-test-reset-token-that-is-longer-than-32-characters';
  try {
    const app = express();
    const router = express.Router();
    app.use(express.json());
    registerSkytechCleanResetRoutes(router, {
      dbPath: fixture.dbPath,
      ensureDb: () => fixture.db,
      readData: name => {
        const row = fixture.db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
        return row ? JSON.parse(row.json) : [];
      },
      createSqliteBackup: async target => fixture.db.backup(target),
      buildInfo: () => ({ commit: 'unit-test' }),
      getAppDisabledConfig: () => ({ disabled: true }),
      getBotDisabledConfig: () => ({ disabled: true }),
      getGsmDisabledConfig: () => ({ disabled: true }),
    });
    app.use('/api', router);

    const backupFilename = 'skytech-pre-clean-reset-20260818T123456Z.zip';
    const guardedBackupPath = safeBackupPath(fixture.dbPath, backupFilename);
    fs.mkdirSync(path.dirname(guardedBackupPath), { recursive: true });
    fs.copyFileSync(fixture.backupPath, guardedBackupPath);
    const backupSha256 = fileSha256(guardedBackupPath);

    await withHttpServer(app, async baseUrl => {
      delete process.env.SKYTECH_CLEAN_RESET_ENABLED;
      let response = await fetch(`${baseUrl}/api/admin/skytech-clean-reset/dry-run`);
      assert.equal(response.status, 404);

      process.env.SKYTECH_CLEAN_RESET_ENABLED = 'true';
      process.env.SKYTECH_CLEAN_RESET_TOKEN = token;
      response = await fetch(`${baseUrl}/api/admin/skytech-clean-reset/dry-run`, {
        headers: { 'X-Skytech-Reset-Token': 'wrong-token' },
      });
      assert.equal(response.status, 403);

      response = await fetch(`${baseUrl}/api/admin/skytech-clean-reset/dry-run`, {
        headers: { 'X-Skytech-Reset-Token': token },
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);

      const blockedAttachment = path.join(fixture.uploads, 'unbacked-business-attachment.zip');
      fs.writeFileSync(blockedAttachment, 'must make the reset backup fail closed');
      response = await fetch(`${baseUrl}/api/admin/skytech-clean-reset/backup`, {
        method: 'POST',
        headers: { 'X-Skytech-Reset-Token': token },
      });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /incomplete.*skipped/i);
      fs.rmSync(blockedAttachment);

      response = await fetch(`${baseUrl}/api/admin/skytech-clean-reset/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Skytech-Reset-Token': token,
        },
        body: JSON.stringify({
          confirmation: PRODUCTION_CONFIRMATION,
          backupFilename,
          backupSha256,
          preResetAudit: 'pass',
        }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);

      response = await fetch(`${baseUrl}/api/admin/skytech-clean-reset/verify`, {
        headers: { 'X-Skytech-Reset-Token': token },
      });
      const verified = await response.json();
      assert.equal(response.status, 200);
      assert.equal(verified.ok, true);
      assert.equal(verified.businessCollectionsRemaining.length, 0);
      assert.equal(verified.businessTablesRemaining.length, 0);
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.SKYTECH_CLEAN_RESET_ENABLED;
    else process.env.SKYTECH_CLEAN_RESET_ENABLED = previousEnabled;
    if (previousToken === undefined) delete process.env.SKYTECH_CLEAN_RESET_TOKEN;
    else process.env.SKYTECH_CLEAN_RESET_TOKEN = previousToken;
    cleanupFixture(fixture);
  }
});

test('pre-compatibility credential is isolated from reset routes and requires a nonce', async () => {
  const fixture = createFixture();
  const token = 'unit-test-pre-compatibility-backup-token-over-32-characters';
  const environmentKeys = [
    'NODE_ENV',
    'RAILWAY_PROJECT_ID',
    'RAILWAY_ENVIRONMENT_ID',
    'RAILWAY_SERVICE_ID',
    'RAILWAY_VOLUME_NAME',
    'RAILWAY_VOLUME_MOUNT_PATH',
    'RAILWAY_REPLICA_ID',
    'RAILWAY_DEPLOYMENT_ID',
    'RAILWAY_GIT_COMMIT_SHA',
    'PRODUCTION_SCOPE_REMEDIATION_ENABLED',
    'PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE',
    'PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY',
    'PRODUCTION_SCOPE_REMEDIATION_VALIDATION_READ_ONLY',
    'PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES',
    'PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE',
    'PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET',
    'SKYTECH_CLEAN_RESET_ENABLED',
    'SKYTECH_CLEAN_RESET_TOKEN',
    'SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED',
    'SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA',
    'SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN',
    'ADMIN_RESET_PASSWORD',
    'APP_DISABLED',
    'BOT_DISABLED',
    'GSM_DISABLED',
    'GSM_ENABLED',
  ];
  const previous = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      RAILWAY_PROJECT_ID: 'test-project',
      RAILWAY_ENVIRONMENT_ID: 'test-environment',
      RAILWAY_SERVICE_ID: 'test-service',
      RAILWAY_VOLUME_NAME: 'test-volume',
      RAILWAY_VOLUME_MOUNT_PATH: path.dirname(fs.realpathSync(fixture.dbPath)),
      RAILWAY_REPLICA_ID: 'test-replica',
      RAILWAY_DEPLOYMENT_ID: 'test-deployment',
      RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
      PRODUCTION_SCOPE_REMEDIATION_ENABLED: 'true',
      PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE: 'true',
      PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY: 'false',
      PRODUCTION_SCOPE_REMEDIATION_VALIDATION_READ_ONLY: 'false',
      PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES: '',
      PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE: '',
      PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET: '',
      SKYTECH_CLEAN_RESET_ENABLED: 'false',
      SKYTECH_CLEAN_RESET_TOKEN: '',
      SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED: 'true',
      SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA: 'a'.repeat(40),
      SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN: token,
      ADMIN_RESET_PASSWORD: '',
      APP_DISABLED: 'true',
      BOT_DISABLED: 'true',
      GSM_DISABLED: 'true',
      GSM_ENABLED: 'false',
    });

    const app = express();
    const router = express.Router();
    app.use(express.json());
    const exactFixtureDbPath = fs.realpathSync(fixture.dbPath);
    let isolatedBackupRuntime = true;
    registerPreCompatibilityBackupRoute(router, {
      dbPath: exactFixtureDbPath,
      ensureDb: () => fixture.db,
      readData: name => {
        const row = fixture.db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
        return row ? JSON.parse(row.json) : [];
      },
      createSqliteBackup: async target => fixture.db.backup(target),
      buildInfo: () => ({ commit: 'unit-test' }),
      expectedEnvironment: {
        projectId: 'test-project',
        environmentId: 'test-environment',
        serviceId: 'test-service',
        volumeName: 'test-volume',
        volumeMountPath: path.dirname(exactFixtureDbPath),
        sourceDbPath: exactFixtureDbPath,
      },
      isBackupOnlyRuntime: () => isolatedBackupRuntime,
      env: process.env,
    });
    app.use('/api', router);

    await withHttpServer(app, async baseUrl => {
      const dedicatedPath = `${baseUrl}/api/admin/skytech-pre-compatibility-backup`;
      let response = await fetch(dedicatedPath, {
        method: 'POST',
        headers: { 'X-Skytech-Reset-Token': token },
      });
      assert.equal(response.status, 403);

      for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
        response = await fetch(dedicatedPath, {
          method,
          headers: { 'X-Skytech-Pre-Compatibility-Backup-Token': token },
        });
        assert.equal(response.status, 404, method);
      }

      for (const [method, suffix] of [
        ['GET', 'dry-run'],
        ['POST', 'apply'],
        ['GET', 'verify'],
        ['POST', 'purge-quarantine'],
      ]) {
        response = await fetch(`${baseUrl}/api/admin/skytech-clean-reset/${suffix}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Skytech-Pre-Compatibility-Backup-Token': token,
          },
          body: method === 'POST' ? JSON.stringify({ confirmation: 'anything' }) : undefined,
        });
        assert.equal(response.status, 404, `${method} ${suffix}`);
      }

      isolatedBackupRuntime = false;
      response = await fetch(dedicatedPath, {
        method: 'POST',
        headers: { 'X-Skytech-Pre-Compatibility-Backup-Token': token },
      });
      assert.equal(response.status, 404, 'the full application runtime cannot expose the preliminary route');
      isolatedBackupRuntime = true;

      process.env.SKYTECH_CLEAN_RESET_ENABLED = 'true';
      process.env.SKYTECH_CLEAN_RESET_TOKEN = token;
      response = await fetch(dedicatedPath, {
        method: 'POST',
        headers: { 'X-Skytech-Pre-Compatibility-Backup-Token': token },
      });
      assert.equal(response.status, 404, 'preliminary and destructive surfaces must not coexist');
      process.env.SKYTECH_CLEAN_RESET_ENABLED = 'false';
      process.env.SKYTECH_CLEAN_RESET_TOKEN = '';

      response = await fetch(dedicatedPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Skytech-Pre-Compatibility-Backup-Token': token,
        },
        body: JSON.stringify({ mode: 'apply', confirmation: PRODUCTION_CONFIRMATION }),
      });
      const body = await response.json();
      assert.equal(response.status, 403);
      assert.equal(body.ok, false);
    });
  } finally {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    cleanupFixture(fixture);
  }
});

test('backup route rejects and does not publish a corrupt SQLite snapshot', async () => {
  const fixture = createFixture();
  const previousEnabled = process.env.SKYTECH_CLEAN_RESET_ENABLED;
  const previousToken = process.env.SKYTECH_CLEAN_RESET_TOKEN;
  const token = 'unit-test-reset-token-that-is-longer-than-32-characters';
  try {
    const app = express();
    const router = express.Router();
    app.use(express.json());
    registerSkytechCleanResetRoutes(router, {
      dbPath: fixture.dbPath,
      ensureDb: () => fixture.db,
      readData: name => {
        const row = fixture.db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
        return row ? JSON.parse(row.json) : [];
      },
      createSqliteBackup: async target => fs.writeFileSync(target, 'definitely-not-a-sqlite-database'),
      buildInfo: () => ({ commit: 'unit-test' }),
      getAppDisabledConfig: () => ({ disabled: true }),
      getBotDisabledConfig: () => ({ disabled: true }),
      getGsmDisabledConfig: () => ({ disabled: true }),
    });
    app.use('/api', router);
    process.env.SKYTECH_CLEAN_RESET_ENABLED = 'true';
    process.env.SKYTECH_CLEAN_RESET_TOKEN = token;

    await withHttpServer(app, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/skytech-clean-reset/backup`, {
        method: 'POST',
        headers: { 'X-Skytech-Reset-Token': token },
      });
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.match(body.error, /sqlite|database/i);
    });

    const backupDir = path.join(fixture.root, 'backups');
    assert.deepEqual(fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [], []);
  } finally {
    if (previousEnabled === undefined) delete process.env.SKYTECH_CLEAN_RESET_ENABLED;
    else process.env.SKYTECH_CLEAN_RESET_ENABLED = previousEnabled;
    if (previousToken === undefined) delete process.env.SKYTECH_CLEAN_RESET_TOKEN;
    else process.env.SKYTECH_CLEAN_RESET_TOKEN = previousToken;
    cleanupFixture(fixture);
  }
});

test('preliminary workflow remains backup-only under the current pinned safety contract', () => {
  const workflow = fs.readFileSync(
    new URL('../.github/workflows/skytech-clean-production-reset.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /expected_deployed_sha:[\s\S]*required: true/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /PRODUCTION_API_ORIGIN: https:\/\/rental-management-production-35bc\.up\.railway\.app/);
  assert.match(workflow, /test "\$PRODUCTION_API_ORIGIN" = "https:\/\/rental-management-production-35bc\.up\.railway\.app"/);
  assert.match(workflow, /npm install --global @railway\/cli@5\.45\.0/);
  assert.match(workflow, /X-Skytech-Pre-Compatibility-Backup-Nonce/);
  assert.match(workflow, /--header "@\$protected_headers"/);
  assert.match(workflow, /\/api\/admin\/skytech-pre-compatibility-backup/);
  assert.match(workflow, /skytech-clean-reset-backup\.zip\.gpg/);
  assert.match(workflow, /--decrypt --output/);
  assert.doesNotMatch(workflow, /inputs\.mode|X-Skytech-Reset-Token/);
  assert.doesNotMatch(workflow, /\/api\/admin\/skytech-clean-reset\/(?:dry-run|apply|verify|purge-quarantine)/);
});
