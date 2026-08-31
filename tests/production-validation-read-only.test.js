import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const Database = serverRequire('better-sqlite3');
const EXPECTED_PRODUCTION_ENVIRONMENT = require(
  '../server/config/production-scope-remediation-environment.js'
);
const {
  PRODUCTION_SMOKE_READER_EMAIL,
  PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
  PRODUCTION_SMOKE_READER_ROLE,
  PRODUCTION_SMOKE_REPLACEMENT_REASON,
  PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
} = require('../server/lib/production-smoke-identity.js');
const {
  assertProductionValidationReadOnlyEnvironment,
  assertProductionValidationWriteAllowed,
  createProductionValidationReadOnlyMiddleware,
  isExactProductionSmokeLogin,
  isExactProductionSmokeReaderUser,
  requested,
  runWithProductionValidationSmokeLoginWrites,
} = require('../server/lib/production-validation-read-only.js');
const {
  assertProductionWriteAllowed,
  executeProductionValidationSmokeLoginWriteTransaction,
  openExactProductionValidationDatabase,
} = require('../server/db.js');

const VALIDATION_ENV = Object.freeze({
  NODE_ENV: 'production',
  DB_PATH: EXPECTED_PRODUCTION_ENVIRONMENT.sourceDbPath,
  RAILWAY_PROJECT_ID: EXPECTED_PRODUCTION_ENVIRONMENT.projectId,
  RAILWAY_ENVIRONMENT_ID: EXPECTED_PRODUCTION_ENVIRONMENT.environmentId,
  RAILWAY_SERVICE_ID: EXPECTED_PRODUCTION_ENVIRONMENT.serviceId,
  RAILWAY_VOLUME_NAME: EXPECTED_PRODUCTION_ENVIRONMENT.volumeName,
  RAILWAY_VOLUME_MOUNT_PATH: EXPECTED_PRODUCTION_ENVIRONMENT.volumeMountPath,
  RAILWAY_REPLICA_ID: 'replica-validation-test',
  RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
  PRODUCTION_SCOPE_REMEDIATION_VALIDATION_READ_ONLY: 'true',
  PRODUCTION_SCOPE_REMEDIATION_ENABLED: 'false',
  PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE: 'false',
  PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY: 'false',
  PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES: '',
  PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE: '',
  APP_DISABLED: 'false',
  BOT_DISABLED: 'true',
  GSM_DISABLED: 'true',
  GSM_ENABLED: 'false',
  SKYTECH_CLEAN_RESET_ENABLED: 'false',
  SKYTECH_CLEAN_RESET_TOKEN: '',
  SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED: 'false',
  SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA: '',
  SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN: '',
  PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET: '',
  ADMIN_RESET_PASSWORD: '',
});

const EXACT_SMOKE_READER = Object.freeze({
  id: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
  name: 'Production smoke reader',
  email: PRODUCTION_SMOKE_READER_EMAIL,
  role: PRODUCTION_SMOKE_READER_ROLE,
  status: 'Активен',
  password: 'h2:scrypt:test:test',
  tokenVersion: 0,
  botOnly: false,
  allowFrontendLogin: true,
  frontendAccess: true,
  replacementForPrincipalId: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
  replacementReason: PRODUCTION_SMOKE_REPLACEMENT_REASON,
});

async function withServer(app, operation) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const { port } = server.address();
    return await operation(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('validation mode requires every conservation flag to be exact before startup', () => {
  assert.equal(requested({}), false);
  assert.equal(assertProductionValidationReadOnlyEnvironment({}), false);
  assert.equal(assertProductionValidationReadOnlyEnvironment(VALIDATION_ENV), true);

  const unsafe = [
    ['NODE_ENV', 'staging'],
    ['DB_PATH', '/tmp/app.sqlite'],
    ['RAILWAY_PROJECT_ID', 'wrong-project'],
    ['RAILWAY_ENVIRONMENT_ID', 'wrong-environment'],
    ['RAILWAY_SERVICE_ID', 'wrong-service'],
    ['RAILWAY_VOLUME_NAME', 'wrong-volume'],
    ['RAILWAY_VOLUME_MOUNT_PATH', '/tmp'],
    ['RAILWAY_REPLICA_ID', ''],
    ['RAILWAY_GIT_COMMIT_SHA', 'mutable'],
    ['PRODUCTION_SCOPE_REMEDIATION_ENABLED', 'true'],
    ['PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE', 'true'],
    ['PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY', undefined],
    ['PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES', 'verify'],
    ['PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE', 'preflight'],
    ['APP_DISABLED', '0'],
    ['BOT_DISABLED', 'false'],
    ['GSM_DISABLED', 'false'],
    ['GSM_ENABLED', 'true'],
    ['SKYTECH_CLEAN_RESET_ENABLED', 'true'],
    ['SKYTECH_CLEAN_RESET_TOKEN', 'configured-secret'],
    ['SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED', 'true'],
    ['SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED', undefined],
    ['SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA', 'a'.repeat(40)],
    ['SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA', undefined],
    ['SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN', 'configured-secret'],
    ['PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET', 'configured-secret'],
    ['ADMIN_RESET_PASSWORD', 'configured-secret'],
    ['ADMIN_RESET_PASSWORD', '   '],
  ];
  for (const [name, value] of unsafe) {
    assert.throws(
      () => assertProductionValidationReadOnlyEnvironment({ ...VALIDATION_ENV, [name]: value }),
      error => error?.code === 'PRODUCTION_VALIDATION_READ_ONLY_CONSERVATION_REQUIRED',
      name,
    );
  }
});

test('validation middleware permits reads and exact login but blocks every other HTTP mutation', async () => {
  const app = express();
  app.use(express.json());
  app.use(createProductionValidationReadOnlyMiddleware({
    getEnabled: () => true,
  }));
  const effects = [];
  app.get('/api/equipment', (_req, res) => res.json({ ok: true, count: 1 }));
  app.post('/api/auth/login', (_req, res) => {
    effects.push('session');
    res.json({ ok: true, token: 'test-session' });
  });
  for (const method of ['post', 'put', 'patch', 'delete']) {
    app[method]('/api/equipment', (_req, res) => {
      effects.push(method);
      res.json({ ok: true });
    });
  }
  app.post('/api/auth/login/extra', (_req, res) => {
    effects.push('wrong-login-path');
    res.json({ ok: true });
  });

  await withServer(app, async baseUrl => {
    const read = await fetch(`${baseUrl}/api/equipment`);
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { ok: true, count: 1 });

    const login = await fetch(`${baseUrl}/api/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: PRODUCTION_SMOKE_READER_EMAIL, password: 'test-only' }),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).token, 'test-session');

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const blocked = await fetch(`${baseUrl}/api/equipment`, { method });
      assert.equal(blocked.status, 503, method);
      assert.equal(blocked.headers.get('retry-after'), '60');
      assert.equal((await blocked.json()).code, 'PRODUCTION_VALIDATION_READ_ONLY');
    }
    const nearMatch = await fetch(`${baseUrl}/api/auth/login/extra`, { method: 'POST' });
    assert.equal(nearMatch.status, 503);
    const wrongActor = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.test', password: 'test-only' }),
    });
    assert.equal(wrongActor.status, 503);
    const extraField = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: PRODUCTION_SMOKE_READER_EMAIL, password: 'test-only', extra: true }),
    });
    assert.equal(extraField.status, 503);
  });

  assert.deepEqual(effects, ['session']);
});

test('only the exact bounded smoke-reader login payload crosses the validation boundary', () => {
  assert.equal(isExactProductionSmokeLogin({
    body: { email: ` ${PRODUCTION_SMOKE_READER_EMAIL} `, password: 'secret' },
  }), true);
  assert.equal(isExactProductionSmokeLogin({
    body: { login: PRODUCTION_SMOKE_READER_EMAIL, password: 'secret' },
  }), true);
  assert.equal(isExactProductionSmokeLogin({
    body: { login: PRODUCTION_SMOKE_READER_EMAIL, password: 'x'.repeat(1025) },
  }), false);
  assert.equal(isExactProductionSmokeLogin({
    body: { login: PRODUCTION_SMOKE_READER_EMAIL, password: 'secret', email: 'same' },
  }), false);
});

test('validation accepts only the exact remediated smoke-reader authority record', () => {
  assert.equal(isExactProductionSmokeReaderUser(EXACT_SMOKE_READER), true);
  for (const [field, value] of [
    ['id', PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID],
    ['email', 'production-smoke-reader@example.test'],
    ['role', 'Администратор'],
    ['status', 'Неактивен'],
    ['tokenVersion', 1],
    ['botOnly', true],
    ['allowFrontendLogin', false],
    ['frontendAccess', false],
    ['replacementForPrincipalId', 'other'],
    ['replacementReason', 'other'],
  ]) {
    assert.equal(isExactProductionSmokeReaderUser({
      ...EXACT_SMOKE_READER,
      [field]: value,
    }), false, field);
  }
});

test('database write gate blocks validation writes outside the exact smoke-login scope', () => {
  assert.throws(
    () => assertProductionValidationWriteAllowed('session write', VALIDATION_ENV),
    error => error?.code === 'PRODUCTION_VALIDATION_READ_ONLY_WRITE_BLOCKED',
  );
  assert.throws(
    () => assertProductionWriteAllowed('collection write (equipment)', VALIDATION_ENV),
    error => error?.code === 'PRODUCTION_VALIDATION_READ_ONLY_WRITE_BLOCKED',
  );

  runWithProductionValidationSmokeLoginWrites(() => {
    for (const operation of [
      'session write',
      'collection compare-and-swap batch write',
      'collection write (audit_logs)',
    ]) {
      assert.equal(assertProductionWriteAllowed(operation, VALIDATION_ENV), true, operation);
    }
    for (const operation of [
      'session deletion',
      'collection write (users)',
      'collection write (equipment)',
      'collection batch write',
      'legacy JSON migration',
    ]) {
      assert.throws(
        () => assertProductionWriteAllowed(operation, VALIDATION_ENV),
        error => error?.code === 'PRODUCTION_VALIDATION_READ_ONLY_WRITE_BLOCKED',
        operation,
      );
    }
    assert.throws(
      () => assertProductionWriteAllowed('session write', {
        ...VALIDATION_ENV,
        PRODUCTION_SCOPE_REMEDIATION_ENABLED: 'true',
        PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE: 'true',
      }),
      error => error?.code === 'PRODUCTION_SCOPE_WRITE_FREEZE_ACTIVE',
    );
  });
});

test('smoke-login write scope is synchronous, non-reentrant, and cannot leak to callbacks', async () => {
  runWithProductionValidationSmokeLoginWrites(() => {
    assert.equal(assertProductionWriteAllowed('session write', VALIDATION_ENV), true);
    assert.throws(
      () => runWithProductionValidationSmokeLoginWrites(() => null),
      error => error?.code === 'PRODUCTION_VALIDATION_TECHNICAL_SCOPE_REENTRANT',
    );
  });

  await new Promise((resolve, reject) => {
    runWithProductionValidationSmokeLoginWrites(() => {
      setImmediate(() => {
        try {
          assert.throws(
            () => assertProductionWriteAllowed('session write', VALIDATION_ENV),
            error => error?.code === 'PRODUCTION_VALIDATION_READ_ONLY_WRITE_BLOCKED',
          );
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
});

test('validation database open rejects symlinks and an inode swap during SQLite open', () => {
  const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'validation-db-identity-')));
  const dbPath = join(tempRoot, 'app.sqlite');
  const decoyPath = join(tempRoot, 'decoy.sqlite');
  const movedPath = join(tempRoot, 'moved.sqlite');
  const symlinkPath = join(tempRoot, 'linked.sqlite');
  try {
    for (const candidate of [dbPath, decoyPath]) {
      const db = new Database(candidate);
      db.exec('CREATE TABLE proof (id TEXT PRIMARY KEY)');
      db.close();
    }

    const opened = openExactProductionValidationDatabase(dbPath);
    assert.deepEqual(opened.pragma('database_list').map(row => row.name), ['main']);
    opened.close();

    symlinkSync(dbPath, symlinkPath);
    assert.throws(
      () => openExactProductionValidationDatabase(symlinkPath),
      error => error?.code === 'VALIDATION_PRODUCTION_DATABASE_IDENTITY_MISMATCH',
    );

    class SwappingDatabase {
      constructor(openPath, options) {
        renameSync(openPath, movedPath);
        renameSync(decoyPath, openPath);
        return new Database(openPath, options);
      }
    }
    assert.throws(
      () => openExactProductionValidationDatabase(dbPath, SwappingDatabase),
      error => error?.code === 'VALIDATION_PRODUCTION_DATABASE_IDENTITY_CHANGED',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SQLite stays query-only and smoke-login technical writes are atomic and synchronous', () => {
  const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'validation-query-only-')));
  const dbPath = join(tempRoot, 'app.sqlite');
  const db = new Database(dbPath);
  try {
    db.exec('CREATE TABLE effects (kind TEXT PRIMARY KEY)');
    db.pragma('query_only = ON');
    assert.throws(
      () => db.prepare('INSERT INTO effects(kind) VALUES (?)').run('outside'),
      /readonly/i,
    );
    assert.throws(
      () => executeProductionValidationSmokeLoginWriteTransaction(
        db,
        () => null,
        VALIDATION_ENV,
      ),
      error => error?.code === 'PRODUCTION_VALIDATION_TRANSACTION_SCOPE_REQUIRED',
    );

    runWithProductionValidationSmokeLoginWrites(() => {
      assert.throws(
        () => executeProductionValidationSmokeLoginWriteTransaction(db, () => {
          db.prepare('INSERT INTO effects(kind) VALUES (?)').run('session');
          db.prepare('INSERT INTO effects(kind) VALUES (?)').run('audit');
          throw new Error('injected audit failure');
        }, VALIDATION_ENV),
        /injected audit failure/,
      );
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM effects').get().count, 0);
      assert.equal(Number(db.pragma('query_only', { simple: true })), 1);

      const result = executeProductionValidationSmokeLoginWriteTransaction(db, () => {
        db.prepare('INSERT INTO effects(kind) VALUES (?)').run('session');
        db.prepare('INSERT INTO effects(kind) VALUES (?)').run('audit');
        return 'committed';
      }, VALIDATION_ENV);
      assert.equal(result, 'committed');
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM effects').get().count, 2);
      assert.equal(Number(db.pragma('query_only', { simple: true })), 1);

      assert.throws(
        () => executeProductionValidationSmokeLoginWriteTransaction(
          db,
          async () => 'not-allowed',
          VALIDATION_ENV,
        ),
        error => error?.code === 'PRODUCTION_VALIDATION_ASYNC_WRITE_FORBIDDEN',
      );
      assert.equal(Number(db.pragma('query_only', { simple: true })), 1);
    });
  } finally {
    db.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('validation middleware is inert unless the exact flag is enabled', async () => {
  const app = express();
  app.use(createProductionValidationReadOnlyMiddleware({ getEnabled: () => false }));
  let writes = 0;
  app.post('/api/equipment', (_req, res) => {
    writes += 1;
    res.status(201).json({ ok: true });
  });

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/equipment`, { method: 'POST' });
    assert.equal(response.status, 201);
  });
  assert.equal(writes, 1);
});

test('database initialization validates conservation and existing storage before opening SQLite', () => {
  const probe = [
    "try { require('./server/db.js').ensureDb(); process.exit(0); }",
    "catch (error) { process.stderr.write(String(error && error.code)); process.exit(42); }",
  ].join(' ');
  const run = overrides => spawnSync(process.execPath, ['-e', probe], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...VALIDATION_ENV,
      ...overrides,
    },
  });

  const unsafe = run({ BOT_DISABLED: 'false' });
  assert.equal(unsafe.status, 42);
  assert.equal(unsafe.stderr, 'PRODUCTION_VALIDATION_READ_ONLY_CONSERVATION_REQUIRED');

  if (!existsSync(VALIDATION_ENV.DB_PATH)) {
    const missing = run({});
    assert.equal(missing.status, 42);
    assert.equal(missing.stderr, 'VALIDATION_PRODUCTION_DATABASE_MISSING');
    assert.equal(existsSync(VALIDATION_ENV.DB_PATH), false);
  }
});

test('server wiring asserts before SQLite, mounts the global boundary, and suppresses runtime writers', () => {
  const serverSource = readFileSync(new URL('../server/server.js', import.meta.url), 'utf8');
  const dbSource = readFileSync(new URL('../server/db.js', import.meta.url), 'utf8');
  const startupSource = readFileSync(new URL('../server/lib/startup.js', import.meta.url), 'utf8');

  const assertionIndex = serverSource.indexOf(
    'const productionValidationReadOnlyEnabled = assertProductionValidationReadOnlyEnvironment();',
  );
  const firstDatabaseOpenIndex = serverSource.indexOf('db: ensureDb()');
  const middlewareIndex = serverSource.indexOf('app.use(createProductionValidationReadOnlyMiddleware({');
  const authRoutesIndex = serverSource.indexOf('registerAuthRoutes(app, {');
  assert.ok(assertionIndex >= 0 && assertionIndex < firstDatabaseOpenIndex);
  assert.ok(middlewareIndex >= 0 && middlewareIndex < authRoutesIndex);
  assert.match(serverSource, /const runtimeMutationSuppressed = productionScopeWriteFreezeEnabled\s*\|\| productionValidationReadOnlyEnabled/);
  assert.match(serverSource, /if \(!runtimeMutationSuppressed\) \{\s*const sessionCleanupTimer/);
  assert.match(serverSource, /productionValidationReadOnlyEnabled,\s*runWithPlatformSystemScope/);
  assert.match(dbSource, /const schemaMutationSuppressed = writeFreezeEnabled \|\| validationReadOnlyEnabled/);
  assert.match(startupSource, /const startupMutationSuppressed = productionScopeWriteFreezeEnabled\s*\|\| productionValidationReadOnlyEnabled/);
  assert.match(serverSource, /productionValidationReadOnlyEnabled\s*&& !isExactProductionSmokeReaderUser\(currentUser\)/);
  assert.match(serverSource, /runWithProductionValidationSmokeLoginWrites\(\s*\(\) => executeProductionValidationSmokeLoginWriteTransaction\(ensureDb\(\), operation\)/);
  assert.match(dbSource, /openExactProductionValidationDatabase\(DB_PATH\)/);
  assert.match(dbSource, /db\.pragma\('query_only = ON'\)/);
});
