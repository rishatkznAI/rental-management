'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const EXPECTED_ENVIRONMENT = require('./config/production-scope-remediation-environment');
const {
  assertPreCompatibilityBackupEnvironment,
} = require('./lib/pre-compatibility-backup');
const {
  registerPreCompatibilityBackupControlRoutes,
} = require('./routes/pre-compatibility-backup');
const {
  createPreCompatibilityBackupCoordinator,
} = require('./lib/pre-compatibility-backup-coordinator');

const STARTED_AT = new Date().toISOString();
const DB_PATH = process.env.DB_PATH;
let server;
let retainedSourceProvider;
let retainedBackupCoordinator;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function descriptorSnapshot() {
  const directory = ['/proc/self/fd', '/dev/fd'].find(candidate => {
    try { return fs.lstatSync(candidate).isDirectory(); } catch { return false; }
  });
  if (!directory) {
    fail('PRE_COMPATIBILITY_DATABASE_DESCRIPTOR_UNAVAILABLE', 'Process descriptor inspection is unavailable.');
  }
  const descriptors = new Map();
  for (const name of fs.readdirSync(directory)) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(name)) continue;
    const fd = Number(name);
    try {
      const stat = fs.fstatSync(fd);
      descriptors.set(fd, { dev: String(stat.dev), ino: String(stat.ino), isFile: stat.isFile() });
    } catch { /* descriptors may close while the directory is enumerated */ }
  }
  return descriptors;
}

function newlyBoundDatabaseDescriptors(before, after, expected) {
  return [...after.entries()].filter(([fd, state]) => {
    const prior = before.get(fd);
    return state.isFile
      && state.dev === String(expected.dev)
      && state.ino === String(expected.ino)
      && (!prior || prior.dev !== state.dev || prior.ino !== state.ino);
  }).map(([fd]) => fd);
}

function matchingDatabaseDescriptors(snapshot, expected) {
  return [...snapshot.entries()].filter(([, state]) => (
    state.isFile
    && state.dev === String(expected.dev)
    && state.ino === String(expected.ino)
  )).map(([fd]) => fd);
}

function openVerifiedReadOnlyDatabase({
  dbPath,
  expectedEnvironment,
  env,
  DatabaseConstructor = Database,
}) {
  if (assertPreCompatibilityBackupEnvironment(env, {
    dbPath,
    expectedEnvironment,
  }) !== true) {
    fail('PRE_COMPATIBILITY_BACKUP_NOT_ENABLED', 'The backup-only runtime is not explicitly enabled.');
  }
  const before = fs.lstatSync(dbPath);
  if (
    !before.isFile()
    || before.isSymbolicLink()
    || before.nlink !== 1
    || path.resolve(dbPath) !== expectedEnvironment.sourceDbPath
    || fs.realpathSync(dbPath) !== expectedEnvironment.sourceDbPath
  ) {
    fail('PRE_COMPATIBILITY_DATABASE_TARGET_INVALID', 'The exact production SQLite target is unavailable.');
  }
  const sourceFd = fs.openSync(dbPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const descriptorBefore = fs.fstatSync(sourceFd);
  if (
    !descriptorBefore.isFile()
    || descriptorBefore.nlink !== 1
    || descriptorBefore.dev !== before.dev
    || descriptorBefore.ino !== before.ino
  ) {
    fs.closeSync(sourceFd);
    fail('PRE_COMPATIBILITY_DATABASE_TARGET_CHANGED', 'The exact production SQLite target changed while binding.');
  }
  let db;
  try {
    const descriptorsBefore = descriptorSnapshot();
    const preexistingDatabaseDescriptors = matchingDatabaseDescriptors(descriptorsBefore, descriptorBefore)
      .filter(fd => fd !== sourceFd);
    if (preexistingDatabaseDescriptors.length > 0) {
      fail(
        'PRE_COMPATIBILITY_DATABASE_DESCRIPTOR_MISMATCH',
        'The isolated backup runtime already has an ambiguous SQLite source descriptor.',
      );
    }
    db = new DatabaseConstructor(dbPath, { readonly: true, fileMustExist: true });
    const descriptorsAfter = descriptorSnapshot();
    const sqliteMainDescriptors = newlyBoundDatabaseDescriptors(
      descriptorsBefore,
      descriptorsAfter,
      descriptorBefore,
    );
    if (sqliteMainDescriptors.length === 0) {
      fail(
        'PRE_COMPATIBILITY_DATABASE_DESCRIPTOR_MISMATCH',
        'The SQLite connection is not descriptor-bound to the exact production inode.',
      );
    }
    db.pragma('foreign_keys = ON');
    db.pragma('query_only = ON');
    const after = fs.lstatSync(dbPath);
    const descriptorAfter = fs.fstatSync(sourceFd);
    const main = db.pragma('database_list').find(row => row.name === 'main');
    if (
      after.dev !== before.dev
      || after.ino !== before.ino
      || after.nlink !== 1
      || after.isSymbolicLink()
      || descriptorAfter.dev !== before.dev
      || descriptorAfter.ino !== before.ino
      || descriptorAfter.nlink !== 1
      || !main?.file
      || fs.realpathSync(main.file) !== expectedEnvironment.sourceDbPath
      || db.pragma('query_only', { simple: true }) !== 1
    ) {
      fail('PRE_COMPATIBILITY_DATABASE_TARGET_CHANGED', 'The exact production SQLite target changed while opening.');
    }
    if (db.pragma('quick_check', { simple: true }) !== 'ok') {
      fail('PRE_COMPATIBILITY_DATABASE_INTEGRITY_FAILED', 'The production SQLite source failed quick_check.');
    }
    const sourceIdentity = {
      dev: String(descriptorAfter.dev),
      ino: String(descriptorAfter.ino),
      realPath: fs.realpathSync(dbPath),
    };
    const assertBound = () => {
      const currentSource = fs.fstatSync(sourceFd);
      const currentPath = fs.lstatSync(dbPath);
      const currentDescriptors = descriptorSnapshot();
      const sqliteDescriptorStillBound = sqliteMainDescriptors.some(fd => {
        const state = currentDescriptors.get(fd);
        return state?.isFile
          && state.dev === sourceIdentity.dev
          && state.ino === sourceIdentity.ino;
      });
      if (
        !sqliteDescriptorStillBound
        || String(currentSource.dev) !== sourceIdentity.dev
        || String(currentSource.ino) !== sourceIdentity.ino
        || String(currentPath.dev) !== sourceIdentity.dev
        || String(currentPath.ino) !== sourceIdentity.ino
        || db.pragma('query_only', { simple: true }) !== 1
      ) {
        fail(
          'PRE_COMPATIBILITY_DATABASE_DESCRIPTOR_MISMATCH',
          'The SQLite connection lost its exact production inode binding.',
        );
      }
      return true;
    };
    assertBound();
    return {
      db,
      sourceFd,
      sourceIdentity,
      assertBound,
      close() {
        try { if (db?.open) db.close(); } finally { fs.closeSync(sourceFd); }
      },
    };
  } catch (error) {
    try { if (db?.open) db.close(); } finally { fs.closeSync(sourceFd); }
    throw error;
  }
}

function createExclusiveSourceProvider(sourceHandle) {
  if (!sourceHandle?.db || typeof sourceHandle.assertBound !== 'function' || typeof sourceHandle.close !== 'function') {
    fail('PRE_COMPATIBILITY_DATABASE_DESCRIPTOR_MISMATCH', 'A verified retained SQLite source handle is required.');
  }
  let leased = false;
  let closed = false;
  sourceHandle.assertBound();
  return {
    sourceIdentity: sourceHandle.sourceIdentity,
    acquire() {
      if (closed) {
        fail('PRE_COMPATIBILITY_DATABASE_SOURCE_CLOSED', 'The retained SQLite source handle is closed.');
      }
      if (leased) {
        fail('PRE_COMPATIBILITY_DATABASE_SOURCE_BUSY', 'The retained SQLite source handle is already leased.');
      }
      sourceHandle.assertBound();
      leased = true;
      let released = false;
      return {
        db: sourceHandle.db,
        sourceFd: sourceHandle.sourceFd,
        sourceIdentity: sourceHandle.sourceIdentity,
        assertBound() {
          if (released || closed) {
            fail('PRE_COMPATIBILITY_DATABASE_SOURCE_CLOSED', 'The retained SQLite source lease is closed.');
          }
          return sourceHandle.assertBound();
        },
        close() {
          if (released) return;
          released = true;
          leased = false;
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      leased = false;
      sourceHandle.close();
    },
  };
}

function openExactReadOnlyDatabase() {
  return openVerifiedReadOnlyDatabase({
    dbPath: DB_PATH,
    expectedEnvironment: EXPECTED_ENVIRONMENT,
    env: process.env,
  });
}

function buildInfo() {
  const commitFull = process.env.RAILWAY_GIT_COMMIT_SHA;
  const requestedReleaseType = [
    process.env.RELEASE_TYPE,
    process.env.RELEASE_PREFLIGHT_RELEASE_TYPE,
    process.env.RAILWAY_RELEASE_TYPE,
  ].map(value => String(value || '').trim().toLowerCase()).find(Boolean) || '';
  const releaseType = ['backend', 'full-stack'].includes(requestedReleaseType)
    ? requestedReleaseType
    : 'unknown';
  return {
    commit: commitFull.slice(0, 7),
    commitFull,
    releaseType,
    release: { type: releaseType },
    startedAt: STARTED_AT,
    deployment: {
      railwayDeploymentId: process.env.RAILWAY_DEPLOYMENT_ID,
      railwayEnvironment: 'production',
      railwayService: 'rental-management',
      railwayReplicaId: process.env.RAILWAY_REPLICA_ID,
    },
  };
}

function backupOnlyVersionAllowedOrigins() {
  return new Set([
    'https://rishatkznai.github.io',
    ...String(process.env.CORS_ORIGIN || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(origin => origin && origin !== '*'),
  ]);
}

function backupOnlyVersionCors(req, res, next) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return next();
  if (!backupOnlyVersionAllowedOrigins().has(origin)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.vary('Origin');
  return next();
}

function registerBackupOnlyHealthRoutes(app) {
  app.get('/health', (_req, res) => res.json({
    ok: true,
    build: buildInfo(),
    mode: 'pre-compatibility-backup-only',
  }));
  app.get('/health/ready', (_req, res) => res.json({
    ok: true,
    ready: true,
    build: buildInfo(),
    mode: 'pre-compatibility-backup-only',
  }));
  app.get('/api/version', backupOnlyVersionCors, (_req, res) => res.json({
    ok: true,
    build: buildInfo(),
    app: { disabled: true },
    mode: 'pre-compatibility-backup-only',
  }));
}

function createApp() {
  const sourceProvider = createExclusiveSourceProvider(openExactReadOnlyDatabase());
  const startupSourceIdentity = sourceProvider.sourceIdentity;
  let backupCoordinator;
  try {
    backupCoordinator = createPreCompatibilityBackupCoordinator({
      runtime: buildInfo(),
      startupSourceIdentity,
    });
  } catch (error) {
    sourceProvider.close();
    throw error;
  }
  const app = express();
  app.locals.preCompatibilityBackupSourceProvider = sourceProvider;
  app.locals.preCompatibilityBackupCoordinator = backupCoordinator;
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '2kb', strict: true }));
  registerBackupOnlyHealthRoutes(app);
  const router = express.Router();
  registerPreCompatibilityBackupControlRoutes(router, {
    coordinator: backupCoordinator,
    dbPath: DB_PATH,
    startupSourceIdentity,
    expectedEnvironment: EXPECTED_ENVIRONMENT,
    isBackupOnlyRuntime: () => true,
  });
  app.use('/api', router);
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
  return app;
}

function shutdown(signal = null) {
  try { retainedBackupCoordinator?.close(); } catch { /* shutdown remains best effort */ }
  retainedBackupCoordinator = undefined;
  const finish = () => {
    try { retainedSourceProvider?.close(); } catch { /* shutdown remains best effort */ }
    retainedSourceProvider = undefined;
    if (signal) process.exit(0);
  };
  if (server?.listening) server.close(finish);
  else finish();
}

function start() {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('PRE_COMPATIBILITY_PORT_INVALID', 'A valid service port is required.');
  }
  const app = createApp();
  retainedSourceProvider = app.locals.preCompatibilityBackupSourceProvider;
  retainedBackupCoordinator = app.locals.preCompatibilityBackupCoordinator;
  server = app.listen(port, '0.0.0.0');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown(signal));
  return server;
}

if (require.main === module) {
  try {
    start();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || 'PRE_COMPATIBILITY_BACKUP_RUNTIME_FAILED',
    })}\n`);
    shutdown();
    process.exitCode = 1;
  }
}

module.exports = {
  backupOnlyVersionCors,
  buildInfo,
  createExclusiveSourceProvider,
  createApp,
  openExactReadOnlyDatabase,
  openVerifiedReadOnlyDatabase,
  registerBackupOnlyHealthRoutes,
  start,
};
