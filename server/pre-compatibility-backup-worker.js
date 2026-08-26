'use strict';

const EXPECTED_ENVIRONMENT = require('./config/production-scope-remediation-environment');
const {
  createExclusiveSourceProvider,
  openExactReadOnlyDatabase,
} = require('./pre-compatibility-backup-server');
const {
  executePreCompatibilityBackup,
} = require('./routes/pre-compatibility-backup');
const {
  WORKER_PROTOCOL,
} = require('./lib/pre-compatibility-backup-coordinator');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MESSAGE_TIMEOUT_MS = 30_000;
let handled = false;
let resultDeliveryComplete = false;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function sameSourceIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino && left?.realPath === right?.realPath;
}

function validateRuntime(runtime) {
  const commitFull = String(process.env.RAILWAY_GIT_COMMIT_SHA || '');
  const startedAt = String(runtime?.startedAt || '');
  const parsedStartedAt = new Date(startedAt);
  if (
    !runtime
    || typeof runtime !== 'object'
    || Array.isArray(runtime)
    || !/^[a-f0-9]{40}$/.test(commitFull)
    || runtime.commitFull !== commitFull
    || runtime.commit !== commitFull.slice(0, 7)
    || !Number.isFinite(parsedStartedAt.getTime())
    || parsedStartedAt.toISOString() !== startedAt
    || runtime.deployment?.railwayDeploymentId !== process.env.RAILWAY_DEPLOYMENT_ID
    || runtime.deployment?.railwayReplicaId !== process.env.RAILWAY_REPLICA_ID
    || runtime.deployment?.railwayEnvironment !== 'production'
    || runtime.deployment?.railwayService !== 'rental-management'
  ) {
    fail('PRE_COMPATIBILITY_BACKUP_WORKER_RUNTIME_MISMATCH', 'The backup worker runtime identity is invalid.');
  }
  return runtime;
}

function sendResult(message, exitCode) {
  if (typeof process.send !== 'function' || !process.connected) {
    process.exitCode = 1;
    return;
  }
  process.send(message, error => {
    process.exitCode = error ? 1 : exitCode;
    resultDeliveryComplete = !error;
    try { process.disconnect(); } catch { /* process exit remains authoritative */ }
  });
}

async function run(message) {
  let sourceProvider;
  let outgoing;
  let exitCode = 1;
  try {
    if (
      handled
      || !message
      || typeof message !== 'object'
      || Array.isArray(message)
      || message.protocol !== WORKER_PROTOCOL
      || !UUID_PATTERN.test(String(message.invocationId || ''))
      || !UUID_PATTERN.test(String(message.requestNonce || ''))
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_WORKER_MESSAGE_INVALID', 'The backup worker message is invalid.');
    }
    handled = true;
    const runtime = validateRuntime(message.runtime);
    sourceProvider = createExclusiveSourceProvider(openExactReadOnlyDatabase());
    if (!sameSourceIdentity(sourceProvider.sourceIdentity, message.startupSourceIdentity)) {
      fail('PRE_COMPATIBILITY_BACKUP_SOURCE_IDENTITY_CHANGED', 'The SQLite source identity changed after runtime startup.');
    }
    const result = await executePreCompatibilityBackup({
      requestNonce: message.requestNonce,
      dbPath: process.env.DB_PATH,
      openSourceDatabase: () => sourceProvider.acquire(),
      startupSourceIdentity: message.startupSourceIdentity,
      buildInfo: () => runtime,
      expectedEnvironment: EXPECTED_ENVIRONMENT,
      isBackupOnlyRuntime: () => true,
      env: process.env,
    });
    outgoing = {
      protocol: WORKER_PROTOCOL,
      invocationId: message.invocationId,
      statusCode: result.statusCode,
      body: result.body,
    };
    exitCode = result.statusCode === 200 || result.statusCode === 201 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      event: 'pre_compatibility_backup_worker_rejected',
      code: typeof error?.code === 'string' ? error.code : 'PRE_COMPATIBILITY_BACKUP_WORKER_FAILED',
    })}\n`);
    outgoing = {
      protocol: WORKER_PROTOCOL,
      invocationId: String(message?.invocationId || ''),
      statusCode: 409,
      body: { ok: false, error: 'Preliminary backup failed.' },
    };
  } finally {
    try { sourceProvider?.close(); } catch { /* result is already fixed */ }
  }
  sendResult(outgoing, exitCode);
}

const messageTimeout = setTimeout(() => {
  process.stderr.write(`${JSON.stringify({
    event: 'pre_compatibility_backup_worker_rejected',
    code: 'PRE_COMPATIBILITY_BACKUP_WORKER_MESSAGE_TIMEOUT',
  })}\n`);
  process.exitCode = 1;
  try { process.disconnect(); } catch { /* process exit remains authoritative */ }
}, MESSAGE_TIMEOUT_MS);
messageTimeout.unref?.();

process.once('message', message => {
  clearTimeout(messageTimeout);
  void run(message);
});

process.once('disconnect', () => {
  if (!resultDeliveryComplete) process.exit(1);
});
