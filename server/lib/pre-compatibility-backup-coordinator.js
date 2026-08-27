'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { fork } = require('node:child_process');

const WORKER_PROTOCOL = 'skytech-pre-compatibility-backup-worker-v1';
const DEFAULT_WORKER_TIMEOUT_MS = 75 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function logFailure(code) {
  process.stderr.write(`${JSON.stringify({
    event: 'pre_compatibility_backup_worker_failed',
    code,
  })}\n`);
}

function createPreCompatibilityBackupCoordinator({
  runtime,
  startupSourceIdentity,
  env = process.env,
  randomUUID = () => crypto.randomUUID(),
  workerPath = path.resolve(__dirname, '..', 'pre-compatibility-backup-worker.js'),
  spawnWorker = (filename, options) => fork(filename, [], options),
  workerTimeoutMs = DEFAULT_WORKER_TIMEOUT_MS,
} = {}) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    fail('PRE_COMPATIBILITY_BACKUP_RUNTIME_INVALID', 'The backup worker runtime identity is required.');
  }
  if (!startupSourceIdentity || typeof startupSourceIdentity !== 'object' || Array.isArray(startupSourceIdentity)) {
    fail('PRE_COMPATIBILITY_BACKUP_SOURCE_IDENTITY_INVALID', 'The backup worker source identity is required.');
  }
  if (!Number.isSafeInteger(workerTimeoutMs) || workerTimeoutMs < 60_000 || workerTimeoutMs > 6 * 60 * 60 * 1000) {
    fail('PRE_COMPATIBILITY_BACKUP_WORKER_TIMEOUT_INVALID', 'The backup worker timeout is invalid.');
  }

  let current = null;
  let closed = false;

  function publicState(operation) {
    if (!operation) return null;
    return {
      invocationId: operation.invocationId,
      requestNonce: operation.requestNonce,
      status: operation.status,
      statusCode: operation.statusCode,
      body: operation.body,
    };
  }

  function settleFailed(operation, code) {
    if (current !== operation || operation.status !== 'RUNNING') return;
    clearTimeout(operation.timeout);
    operation.status = 'FAILED';
    operation.statusCode = 409;
    operation.body = { ok: false, error: 'Preliminary backup failed.' };
    logFailure(code);
  }

  function terminate(operation) {
    try {
      if (operation?.child?.connected) operation.child.disconnect();
    } catch { /* termination remains best effort */ }
    try {
      if (operation?.child && operation.child.exitCode === null) operation.child.kill('SIGTERM');
    } catch { /* termination remains best effort */ }
  }

  function settleMessage(operation, message) {
    if (current !== operation || operation.status !== 'RUNNING') return;
    const commonValid = message
      && typeof message === 'object'
      && !Array.isArray(message)
      && message.protocol === WORKER_PROTOCOL
      && message.invocationId === operation.invocationId;
    const validSuccess = commonValid
      && (message.statusCode === 200 || message.statusCode === 201)
      && message.body
      && typeof message.body === 'object'
      && !Array.isArray(message.body)
      && message.body.ok === true
      && message.body.backup
      && typeof message.body.backup === 'object'
      && !Array.isArray(message.body.backup)
      && message.body.backup.requestNonce === operation.requestNonce;
    const validFailure = commonValid
      && message.statusCode === 409
      && message.body
      && typeof message.body === 'object'
      && !Array.isArray(message.body)
      && message.body.ok === false;
    if (validFailure) {
      settleFailed(operation, 'PRE_COMPATIBILITY_BACKUP_WORKER_OPERATION_FAILED');
      return;
    }
    if (!validSuccess) {
      settleFailed(operation, 'PRE_COMPATIBILITY_BACKUP_WORKER_RESPONSE_INVALID');
      terminate(operation);
      return;
    }
    clearTimeout(operation.timeout);
    operation.status = 'COMPLETE';
    operation.statusCode = message.statusCode;
    operation.body = message.body;
  }

  function start(requestNonce) {
    if (closed) {
      fail('PRE_COMPATIBILITY_BACKUP_COORDINATOR_CLOSED', 'The backup coordinator is closed.');
    }
    if (!UUID_PATTERN.test(String(requestNonce || ''))) {
      fail('PRE_COMPATIBILITY_BACKUP_NONCE_INVALID', 'A valid preliminary backup request nonce is required.');
    }
    if (current?.status === 'RUNNING') {
      if (current.requestNonce === requestNonce) {
        return { ...publicState(current), reused: true };
      }
      fail('PRE_COMPATIBILITY_BACKUP_SOURCE_BUSY', 'A preliminary backup worker is already running.');
    }
    if (current) terminate(current);

    const invocationId = randomUUID();
    if (!UUID_PATTERN.test(String(invocationId || ''))) {
      fail('PRE_COMPATIBILITY_BACKUP_INVOCATION_ID_INVALID', 'A valid backup invocation ID is required.');
    }
    let child;
    try {
      child = spawnWorker(workerPath, {
        env: { ...env },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
    } catch {
      fail('PRE_COMPATIBILITY_BACKUP_WORKER_START_FAILED', 'The preliminary backup worker could not start.');
    }
    if (!child || typeof child.on !== 'function' || typeof child.send !== 'function') {
      try { child?.kill?.('SIGTERM'); } catch { /* invalid worker already fails closed */ }
      fail('PRE_COMPATIBILITY_BACKUP_WORKER_START_FAILED', 'The preliminary backup worker could not start.');
    }

    const operation = {
      invocationId,
      requestNonce,
      status: 'RUNNING',
      statusCode: 202,
      body: null,
      child,
      timeout: null,
    };
    current = operation;
    operation.timeout = setTimeout(() => {
      settleFailed(operation, 'PRE_COMPATIBILITY_BACKUP_WORKER_TIMEOUT');
      terminate(operation);
    }, workerTimeoutMs);
    operation.timeout.unref?.();
    child.on('message', message => settleMessage(operation, message));
    child.once('error', () => settleFailed(operation, 'PRE_COMPATIBILITY_BACKUP_WORKER_PROCESS_ERROR'));
    child.once('exit', code => {
      if (operation.status === 'RUNNING') {
        settleFailed(operation, code === 0
          ? 'PRE_COMPATIBILITY_BACKUP_WORKER_EXITED_WITHOUT_RESULT'
          : 'PRE_COMPATIBILITY_BACKUP_WORKER_EXITED');
      }
    });
    child.send({
      protocol: WORKER_PROTOCOL,
      invocationId,
      requestNonce,
      runtime,
      startupSourceIdentity,
    }, error => {
      if (error) settleFailed(operation, 'PRE_COMPATIBILITY_BACKUP_WORKER_IPC_FAILED');
    });
    return { ...publicState(operation), reused: false };
  }

  function status({ requestNonce, invocationId }) {
    if (
      !current
      || current.requestNonce !== requestNonce
      || current.invocationId !== invocationId
    ) {
      return null;
    }
    return publicState(current);
  }

  function close() {
    if (closed) return;
    closed = true;
    if (current?.status === 'RUNNING') {
      settleFailed(current, 'PRE_COMPATIBILITY_BACKUP_COORDINATOR_CLOSED');
    }
    if (current) terminate(current);
  }

  return { close, start, status };
}

module.exports = {
  DEFAULT_WORKER_TIMEOUT_MS,
  WORKER_PROTOCOL,
  createPreCompatibilityBackupCoordinator,
};
