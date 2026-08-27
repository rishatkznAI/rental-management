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
  createExclusiveSourceProvider,
  openVerifiedReadOnlyDatabase,
} = require('../server/pre-compatibility-backup-server.js');
const {
  RECEIPT_FILENAME,
  executePreCompatibilityBackup,
  registerPreCompatibilityBackupControlRoutes,
} = require('../server/routes/pre-compatibility-backup.js');

const TOKEN = 'b'.repeat(32);
const SOURCE_COMMIT = 'a'.repeat(40);
const CURRENT_COMMIT = 'c'.repeat(40);
const REQUEST_NONCE = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const ARTIFACT_ENDPOINT = '/api/admin/skytech-pre-compatibility-backup/artifacts';

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function createFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-artifact-download-')));
  const dbPath = path.join(root, 'app.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare('INSERT INTO app_data(name, json) VALUES (?, ?)')
    .run('clients', JSON.stringify([{ id: 'C-1', name: 'Historical client' }]));
  db.close();
  const businessDirectory = path.join(root, 'uploads', 'equipment');
  fs.mkdirSync(businessDirectory, { recursive: true });
  const businessFilePath = path.join(businessDirectory, 'photo.jpg');
  fs.writeFileSync(businessFilePath, 'historical-business-photo');
  return { businessFilePath, dbPath: fs.realpathSync(dbPath), root };
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

function frozenEnvironment(dbPath, commit) {
  return {
    NODE_ENV: 'production',
    DB_PATH: dbPath,
    RAILWAY_PROJECT_ID: 'project',
    RAILWAY_ENVIRONMENT_ID: 'environment',
    RAILWAY_SERVICE_ID: 'service',
    RAILWAY_VOLUME_NAME: 'volume',
    RAILWAY_VOLUME_MOUNT_PATH: path.dirname(dbPath),
    RAILWAY_REPLICA_ID: 'replica-current',
    RAILWAY_DEPLOYMENT_ID: 'deployment-current',
    RAILWAY_GIT_COMMIT_SHA: commit,
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
    SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA: commit,
    SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN: TOKEN,
    ADMIN_RESET_PASSWORD: '',
  };
}

function runtimeInfo(env) {
  return {
    commit: env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7),
    commitFull: env.RAILWAY_GIT_COMMIT_SHA,
    releaseType: 'full-stack',
    release: { type: 'full-stack' },
    startedAt: '2026-08-26T00:00:00.000Z',
    deployment: {
      railwayDeploymentId: env.RAILWAY_DEPLOYMENT_ID,
      railwayEnvironment: 'production',
      railwayService: 'rental-management',
      railwayReplicaId: env.RAILWAY_REPLICA_ID,
    },
  };
}

async function createCompletedBackup(fixture) {
  const env = frozenEnvironment(fixture.dbPath, SOURCE_COMMIT);
  const expected = expectedEnvironment(fixture.dbPath);
  const sourceProvider = createExclusiveSourceProvider(openVerifiedReadOnlyDatabase({
    dbPath: fixture.dbPath,
    expectedEnvironment: expected,
    env,
  }));
  try {
    const result = await executePreCompatibilityBackup({
      requestNonce: REQUEST_NONCE,
      dbPath: fixture.dbPath,
      openSourceDatabase: () => sourceProvider.acquire(),
      startupSourceIdentity: sourceProvider.sourceIdentity,
      buildInfo: () => runtimeInfo(env),
      expectedEnvironment: expected,
      isBackupOnlyRuntime: () => true,
      env,
      now: () => new Date('2026-08-26T12:34:56.000Z'),
      randomUUID: () => OPERATION_ID,
    });
    assert.equal(result.statusCode, 201, JSON.stringify(result.body));
    const backupDirectory = path.join(fixture.root, 'backups');
    return {
      archivePath: path.join(backupDirectory, result.body.backup.filename),
      receiptPath: path.join(backupDirectory, RECEIPT_FILENAME),
      result,
    };
  } finally {
    sourceProvider.close();
  }
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

async function withDownloadServer(
  fixture,
  operation,
  routeEnvironmentOverrides = {},
  currentCommit = CURRENT_COMMIT,
) {
  const expected = expectedEnvironment(fixture.dbPath);
  const currentEnvironment = frozenEnvironment(fixture.dbPath, currentCommit);
  const sourceProvider = createExclusiveSourceProvider(openVerifiedReadOnlyDatabase({
    dbPath: fixture.dbPath,
    expectedEnvironment: expected,
    env: currentEnvironment,
  }));
  const app = express();
  const router = express.Router();
  registerPreCompatibilityBackupControlRoutes(router, {
    coordinator: {
      start() { throw new Error('not used by artifact tests'); },
      status() { return null; },
    },
    dbPath: fixture.dbPath,
    openSourceDatabase: () => sourceProvider.acquire(),
    startupSourceIdentity: sourceProvider.sourceIdentity,
    expectedEnvironment: expected,
    isBackupOnlyRuntime: () => true,
    env: { ...currentEnvironment, ...routeEnvironmentOverrides },
  });
  app.use('/api', router);
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
  try {
    return await withServer(app, operation);
  } finally {
    sourceProvider.close();
  }
}

function artifactHeaders({
  token = TOKEN,
  nonce = REQUEST_NONCE,
  sourceCommit = SOURCE_COMMIT,
  origin,
} = {}) {
  const headers = {};
  if (token !== null) headers['X-Skytech-Pre-Compatibility-Backup-Token'] = token;
  if (nonce !== null) headers['X-Skytech-Pre-Compatibility-Backup-Nonce'] = nonce;
  if (sourceCommit !== null) {
    headers['X-Skytech-Pre-Compatibility-Backup-Source-Commit'] = sourceCommit;
  }
  if (origin) headers.Origin = origin;
  return headers;
}

async function captureStderr(operation) {
  const originalWrite = process.stderr.write;
  let output = '';
  process.stderr.write = (chunk, encoding, callback) => {
    output += String(chunk);
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
    return true;
  };
  try {
    return { result: await operation(), output };
  } finally {
    process.stderr.write = originalWrite;
  }
}

test('artifact downloads recover a historical deploy with exact bytes, hashes, and non-CORS headers', async () => {
  const fixture = createFixture();
  try {
    const completed = await createCompletedBackup(fixture);
    const receiptBytes = fs.readFileSync(completed.receiptPath);
    const archiveBytes = fs.readFileSync(completed.archivePath);
    const receiptSha256 = sha256Bytes(receiptBytes);
    const archiveSha256 = sha256Bytes(archiveBytes);
    assert.notEqual(SOURCE_COMMIT, CURRENT_COMMIT);

    await withDownloadServer(fixture, async baseUrl => {
      const receiptResponse = await fetch(`${baseUrl}${ARTIFACT_ENDPOINT}/receipt`, {
        headers: artifactHeaders({ origin: 'https://attacker.example' }),
        redirect: 'manual',
      });
      const downloadedReceipt = Buffer.from(await receiptResponse.arrayBuffer());
      assert.equal(receiptResponse.status, 200);
      assert.deepEqual(downloadedReceipt, receiptBytes);
      assert.equal(receiptResponse.headers.get('content-length'), String(receiptBytes.length));
      assert.equal(
        receiptResponse.headers.get('content-disposition'),
        `attachment; filename="${RECEIPT_FILENAME}"`,
      );
      assert.match(receiptResponse.headers.get('content-type'), /^application\/json\b/);
      assert.equal(
        receiptResponse.headers.get('x-skytech-pre-compatibility-backup-content-sha256'),
        receiptSha256,
      );
      assert.equal(
        receiptResponse.headers.get('x-skytech-pre-compatibility-backup-receipt-sha256'),
        receiptSha256,
      );
      assert.equal(
        receiptResponse.headers.get('x-skytech-pre-compatibility-backup-source-commit'),
        SOURCE_COMMIT,
      );
      assert.equal(receiptResponse.headers.get('access-control-allow-origin'), null);
      assert.equal(receiptResponse.headers.get('access-control-allow-credentials'), null);
      assert.equal(receiptResponse.headers.get('content-encoding'), null);
      assert.equal(receiptResponse.headers.get('location'), null);
      assert.equal(receiptResponse.headers.get('cache-control'), 'no-store');
      assert.equal(receiptResponse.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(
        receiptResponse.headers.get('content-security-policy'),
        "default-src 'none'; frame-ancestors 'none'",
      );
      assert.equal(
        receiptResponse.headers.get('strict-transport-security'),
        'max-age=31536000; includeSubDomains',
      );

      const archiveResponse = await fetch(`${baseUrl}${ARTIFACT_ENDPOINT}/archive`, {
        headers: artifactHeaders(),
        redirect: 'manual',
      });
      const downloadedArchive = Buffer.from(await archiveResponse.arrayBuffer());
      assert.equal(archiveResponse.status, 200);
      assert.deepEqual(downloadedArchive, archiveBytes);
      assert.equal(archiveResponse.headers.get('content-length'), String(archiveBytes.length));
      assert.equal(
        archiveResponse.headers.get('content-disposition'),
        `attachment; filename="${path.basename(completed.archivePath)}"`,
      );
      assert.equal(archiveResponse.headers.get('content-type'), 'application/zip');
      assert.equal(
        archiveResponse.headers.get('x-skytech-pre-compatibility-backup-content-sha256'),
        archiveSha256,
      );
      assert.equal(
        archiveResponse.headers.get('x-skytech-pre-compatibility-backup-receipt-sha256'),
        receiptSha256,
      );
      assert.equal(
        archiveResponse.headers.get('x-skytech-pre-compatibility-backup-source-commit'),
        SOURCE_COMMIT,
      );
      assert.equal(archiveResponse.headers.get('access-control-allow-origin'), null);
      assert.equal(archiveResponse.headers.get('access-control-allow-credentials'), null);
      assert.equal(archiveResponse.headers.get('content-encoding'), null);
      assert.equal(archiveResponse.headers.get('location'), null);
    });

    await withDownloadServer(fixture, async baseUrl => {
      const response = await fetch(`${baseUrl}${ARTIFACT_ENDPOINT}/receipt`, {
        headers: artifactHeaders(),
        redirect: 'manual',
      });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), receiptBytes);
    }, {}, SOURCE_COMMIT);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('artifact routes preserve the token and nonce gate and require the exact receipt source commit', async () => {
  const fixture = createFixture();
  try {
    await createCompletedBackup(fixture);
    await withDownloadServer(fixture, async baseUrl => {
      const endpoint = `${baseUrl}${ARTIFACT_ENDPOINT}/receipt`;
      for (const [name, headers, expectedStatus] of [
        ['missing token', artifactHeaders({ token: null }), 403],
        ['wrong token', artifactHeaders({ token: 'd'.repeat(32) }), 403],
        ['missing nonce', artifactHeaders({ nonce: null }), 403],
        ['malformed nonce', artifactHeaders({ nonce: 'not-a-uuid' }), 403],
        ['wrong valid nonce', artifactHeaders({ nonce: '33333333-3333-4333-8333-333333333333' }), 403],
        ['missing source commit', artifactHeaders({ sourceCommit: null }), 403],
        ['malformed source commit', artifactHeaders({ sourceCommit: 'short' }), 403],
        ['wrong historical commit', artifactHeaders({ sourceCommit: CURRENT_COMMIT }), 403],
        ['uppercase historical commit', artifactHeaders({ sourceCommit: SOURCE_COMMIT.toUpperCase() }), 403],
      ]) {
        const response = await fetch(endpoint, { headers, redirect: 'manual' });
        assert.equal(response.status, expectedStatus, name);
        assert.deepEqual(await response.json(), { ok: false, error: 'Forbidden' }, name);
        assert.equal(response.headers.get('location'), null, name);
        assert.equal(response.headers.get('access-control-allow-origin'), null, name);
      }

      for (const suffix of ['manifest', '../receipt/extra']) {
        const response = await fetch(`${baseUrl}${ARTIFACT_ENDPOINT}/${suffix}`, {
          headers: artifactHeaders(),
          redirect: 'manual',
        });
        assert.equal(response.status, 404, suffix);
      }
      const wrongMethod = await fetch(endpoint, {
        method: 'POST',
        headers: artifactHeaders(),
        redirect: 'manual',
      });
      assert.equal(wrongMethod.status, 404);

      const headResponse = await fetch(endpoint, {
        method: 'HEAD',
        headers: artifactHeaders(),
        redirect: 'manual',
      });
      assert.equal(headResponse.status, 405);
      assert.equal(headResponse.headers.get('allow'), 'GET');
      assert.equal(await headResponse.text(), '');
      assert.equal(headResponse.headers.get('access-control-allow-origin'), null);

      const optionsResponse = await fetch(endpoint, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://attacker.example',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'x-skytech-pre-compatibility-backup-token',
        },
        redirect: 'manual',
      });
      assert.equal(optionsResponse.status, 405);
      assert.equal(optionsResponse.headers.get('allow'), 'GET');
      assert.equal(optionsResponse.headers.get('access-control-allow-origin'), null);

      for (const [name, modifier] of [
        ['range', { Range: 'bytes=0-9' }],
        ['if-range', { 'If-Range': 'stale' }],
        ['if-match', { 'If-Match': '*' }],
        ['if-none-match', { 'If-None-Match': '*' }],
        ['if-modified-since', { 'If-Modified-Since': new Date(0).toUTCString() }],
        ['if-unmodified-since', { 'If-Unmodified-Since': new Date().toUTCString() }],
      ]) {
        const response = await fetch(endpoint, {
          headers: { ...artifactHeaders(), ...modifier },
          redirect: 'manual',
        });
        assert.equal(response.status, 400, name);
        assert.deepEqual(
          await response.json(),
          { ok: false, error: 'Unsupported artifact request.' },
          name,
        );
        assert.equal(response.headers.get('access-control-allow-origin'), null, name);
      }
    });

    await withDownloadServer(fixture, async baseUrl => {
      const response = await fetch(`${baseUrl}${ARTIFACT_ENDPOINT}/receipt`, {
        headers: artifactHeaders(),
      });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { ok: false, error: 'Not found' });
    }, { SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED: 'false' });

    await withDownloadServer(fixture, async baseUrl => {
      const response = await fetch(`${baseUrl}${ARTIFACT_ENDPOINT}/receipt`, {
        headers: artifactHeaders(),
      });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { ok: false, error: 'Not found' });
    }, { SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA: SOURCE_COMMIT });

    const backupDirectory = path.join(fixture.root, 'backups');
    const heldBackupDirectory = path.join(fixture.root, 'backups-held');
    fs.renameSync(backupDirectory, heldBackupDirectory);
    try {
      await withDownloadServer(fixture, async baseUrl => {
        const response = await fetch(`${baseUrl}${ARTIFACT_ENDPOINT}/receipt`, {
          headers: artifactHeaders({ token: 'd'.repeat(32) }),
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { ok: false, error: 'Forbidden' });
      });
      const { result: missingDirectoryResponse } = await captureStderr(() => withDownloadServer(
        fixture,
        baseUrl => fetch(`${baseUrl}${ARTIFACT_ENDPOINT}/receipt`, {
          headers: artifactHeaders(),
        }),
      ));
      assert.equal(missingDirectoryResponse.status, 409);
      assert.deepEqual(
        await missingDirectoryResponse.json(),
        { ok: false, error: 'Backup artifact unavailable.' },
      );
      assert.equal(fs.existsSync(backupDirectory), false);
      assert.equal(fs.existsSync(heldBackupDirectory), true);
    } finally {
      fs.renameSync(heldBackupDirectory, backupDirectory);
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('artifact downloads fail closed for symlinks, non-0600 modes, and multiple links', async t => {
  for (const testCase of [
    {
      name: 'receipt symlink',
      mutate({ receiptPath }) {
        const originalPath = `${receiptPath}.original`;
        fs.renameSync(receiptPath, originalPath);
        fs.symlinkSync(path.basename(originalPath), receiptPath);
      },
    },
    {
      name: 'archive symlink',
      mutate({ archivePath }) {
        const originalPath = `${archivePath}.original`;
        fs.renameSync(archivePath, originalPath);
        fs.symlinkSync(path.basename(originalPath), archivePath);
      },
    },
    {
      name: 'receipt mode',
      mutate({ receiptPath }) { fs.chmodSync(receiptPath, 0o640); },
    },
    {
      name: 'archive mode',
      mutate({ archivePath }) { fs.chmodSync(archivePath, 0o400); },
    },
    {
      name: 'receipt hard link',
      mutate({ receiptPath }) { fs.linkSync(receiptPath, `${receiptPath}.second-link`); },
    },
    {
      name: 'archive hard link',
      mutate({ archivePath }) { fs.linkSync(archivePath, `${archivePath}.second-link`); },
    },
    {
      name: 'backup directory mode is not tightened by GET',
      mutate({ archivePath }) { fs.chmodSync(path.dirname(archivePath), 0o750); },
      verify({ archivePath }) {
        assert.equal(fs.statSync(path.dirname(archivePath)).mode & 0o777, 0o750);
      },
    },
  ]) {
    await t.test(testCase.name, async () => {
      const fixture = createFixture();
      try {
        const completed = await createCompletedBackup(fixture);
        testCase.mutate(completed);
        const { result: response, output } = await captureStderr(() => withDownloadServer(
          fixture,
          baseUrl => fetch(`${baseUrl}${ARTIFACT_ENDPOINT}/archive`, {
            headers: artifactHeaders({ origin: 'https://attacker.example' }),
            redirect: 'manual',
          }),
        ));
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { ok: false, error: 'Backup artifact unavailable.' });
        assert.equal(response.headers.get('access-control-allow-origin'), null);
        assert.equal(response.headers.get('location'), null);
        assert.doesNotMatch(output, new RegExp(TOKEN));
        testCase.verify?.(completed);
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test('artifact downloads revalidate receipt, archive, source inode/state, SQLite, and business inventory', async t => {
  for (const testCase of [
    {
      name: 'receipt hash mutation',
      mutate(_fixture, { receiptPath }) {
        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        receipt.archive.sha256 = '0'.repeat(64);
        fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
        fs.chmodSync(receiptPath, 0o600);
      },
    },
    {
      name: 'historical receipt runtime mutation',
      mutate(_fixture, { receiptPath }) {
        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        receipt.runtime.deployment.railwayEnvironment = 'staging';
        fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
        fs.chmodSync(receiptPath, 0o600);
      },
    },
    {
      name: 'archive byte mutation',
      mutate(_fixture, { archivePath }) {
        const fd = fs.openSync(archivePath, 'r+');
        try {
          const position = Math.floor(fs.fstatSync(fd).size / 2);
          const byte = Buffer.alloc(1);
          fs.readSync(fd, byte, 0, 1, position);
          byte[0] ^= 0xff;
          fs.writeSync(fd, byte, 0, 1, position);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      },
    },
    {
      name: 'business inventory mutation',
      mutate(fixture) { fs.writeFileSync(fixture.businessFilePath, 'mutated-business-photo'); },
    },
    {
      name: 'SQLite state mutation',
      mutate(fixture) {
        const db = new Database(fixture.dbPath);
        db.prepare('UPDATE app_data SET json = ? WHERE name = ?')
          .run(JSON.stringify([{ id: 'C-2', name: 'Mutated client' }]), 'clients');
        db.close();
      },
    },
    {
      name: 'SQLite inode replacement',
      mutate(fixture) {
        const replacementPath = path.join(fixture.root, 'replacement.sqlite');
        fs.copyFileSync(fixture.dbPath, replacementPath);
        fs.renameSync(replacementPath, fixture.dbPath);
      },
    },
  ]) {
    await t.test(testCase.name, async () => {
      const fixture = createFixture();
      try {
        const completed = await createCompletedBackup(fixture);
        testCase.mutate(fixture, completed);
        const { result: response, output } = await captureStderr(() => withDownloadServer(
          fixture,
          baseUrl => fetch(`${baseUrl}${ARTIFACT_ENDPOINT}/archive`, {
            headers: artifactHeaders(),
            redirect: 'manual',
          }),
        ));
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { ok: false, error: 'Backup artifact unavailable.' });
        assert.equal(response.headers.get('x-skytech-pre-compatibility-backup-content-sha256'), null);
        assert.equal(response.headers.get('x-skytech-pre-compatibility-backup-source-commit'), null);
        assert.doesNotMatch(output, new RegExp(TOKEN));
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    });
  }
});
