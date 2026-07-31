import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  createPr9bContext,
  postingGraphSnapshot,
} from './canonical-actual-posting-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const express = serverRequire('express');
const {
  buildCanonicalActualPostingRuntimeConfig,
} = require('../server/lib/canonical-actual-posting-runtime-config.js');
const {
  CANONICAL_ACTUAL_POSTING_RUNTIME_PATH,
  registerCanonicalActualPostingRuntimeRoutes,
} = require('../server/routes/canonical-actual-posting-runtime.js');

const TRIGGER_TOKEN = 'pr9c-staging-trigger-token-0123456789abcdef';
const WORKER_PATH = new URL('./helpers/canonical-actual-posting-runtime-worker.mjs', import.meta.url);

function enabledEnv(context, overrides = {}) {
  return {
    APP_ENVIRONMENT: 'staging',
    CANONICAL_ACTUAL_POSTING_RUNTIME_AUTHORITIES_JSON: JSON.stringify(
      context.runtimeContractInput.authorities,
    ),
    CANONICAL_ACTUAL_POSTING_RUNTIME_ENABLED: 'true',
    CANONICAL_ACTUAL_POSTING_TRIGGER_TOKEN: TRIGGER_TOKEN,
    ...overrides,
  };
}

function routePath(eventId) {
  return `/api${CANONICAL_ACTUAL_POSTING_RUNTIME_PATH.replace(':eventId', encodeURIComponent(eventId))}`;
}

function selector(context) {
  return {
    branchId: context.event.branchId,
    companyId: context.event.companyId,
    eventId: context.event.id,
  };
}

function appFor(config, db) {
  const app = express();
  const router = express.Router();
  app.use(express.json({ limit: '32kb' }));
  registerCanonicalActualPostingRuntimeRoutes(router, {
    ...config,
    db,
    logger: { error() {}, log() {}, warn() {} },
  });
  app.use('/api', router);
  return app;
}

async function postJson(app, requestPath, body, token = TRIGGER_TOKEN) {
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    const text = await response.text();
    let responseBody = null;
    try {
      responseBody = text ? JSON.parse(text) : null;
    } catch {
      responseBody = text;
    }
    return {
      body: responseBody,
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
    };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function primaryCounts(db) {
  return {
    audits: Number(db.prepare(`
      SELECT COUNT(*) AS count FROM financial_audit_events
      WHERE eventType = 'canonical_receivable.initial_posted.v1'
    `).get().count),
    operations: Number(db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_operations').get().count),
    receivables: Number(db.prepare('SELECT COUNT(*) AS count FROM canonical_receivables').get().count),
  };
}

function startWorker(input) {
  const child = fork(WORKER_PATH, [], {
    env: { ...process.env, PR9C_WORKER_INPUT: JSON.stringify(input) },
    silent: true,
  });
  let resultMessage = null;
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const ready = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('message', message => {
      if (message?.type === 'ready') resolve();
      if (message?.type === 'result') resultMessage = message;
    });
  });
  const complete = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('PR9C runtime worker timed out.'));
    }, 20_000);
    child.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || stderr) {
        reject(new Error(`PR9C runtime worker failed: code=${code} stderr=${stderr}`));
      } else if (!resultMessage) {
        reject(new Error('PR9C runtime worker returned no result.'));
      } else {
        resolve(resultMessage);
      }
    });
  });
  return { child, complete, ready };
}

test('PR9C is disabled by default, hard-blocked outside staging, and performs zero business DML', async () => {
  const context = createPr9bContext();
  try {
    const before = postingGraphSnapshot(context.db);
    const disabled = buildCanonicalActualPostingRuntimeConfig({});
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.diagnostics.reason, 'flag_disabled');

    const response = await postJson(
      appFor(disabled, null),
      routePath(context.event.id),
      { branchId: context.event.branchId, companyId: context.event.companyId },
    );
    assert.equal(response.status, 404);
    assert.equal(postingGraphSnapshot(context.db), before);

    const production = buildCanonicalActualPostingRuntimeConfig(enabledEnv(context, {
      APP_ENVIRONMENT: 'production',
      NODE_ENV: 'production',
    }));
    assert.equal(production.enabled, false);
    assert.equal(production.diagnostics.productionAllowed, false);
    assert.equal(production.diagnostics.reason, 'staging_environment_required');
    assert.equal(postingGraphSnapshot(context.db), before);

    const conflictingLabels = buildCanonicalActualPostingRuntimeConfig(enabledEnv(context, {
      APP_ENVIRONMENT: 'staging',
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'production',
    }));
    assert.equal(conflictingLabels.enabled, false);
    assert.equal(conflictingLabels.diagnostics.reason, 'staging_environment_required');
    assert.equal(postingGraphSnapshot(context.db), before);
  } finally {
    context.db.close();
  }
});

test('PR9C staging trigger invokes PR9B and posts one canonical primary triplet', async () => {
  const context = createPr9bContext();
  try {
    const config = buildCanonicalActualPostingRuntimeConfig(enabledEnv(context));
    assert.equal(config.enabled, true);
    assert.deepEqual(config.diagnostics, {
      enabled: true,
      environment: 'staging',
      productionAllowed: false,
      reason: 'staging_enabled',
      requested: true,
      triggerTokenConfigured: true,
    });
    const app = appFor(config, context.db);

    const unauthorizedBefore = postingGraphSnapshot(context.db);
    const unauthorized = await postJson(
      app,
      routePath(context.event.id),
      { branchId: context.event.branchId, companyId: context.event.companyId },
      'wrong-token',
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(postingGraphSnapshot(context.db), unauthorizedBefore);

    const response = await postJson(
      app,
      routePath(context.event.id),
      { branchId: context.event.branchId, companyId: context.event.companyId },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.result.event.eventId, context.event.id);
    assert.equal(response.body.result.posting.outcome, 'POSTED');
    assert.equal(response.body.result.posting.replayed, false);
    assert.deepEqual(primaryCounts(context.db), { audits: 1, operations: 1, receivables: 1 });
  } finally {
    context.db.close();
  }
});

test('PR9C repeated invocation is a stable read-only PR9B replay with no duplicate posting', async () => {
  const context = createPr9bContext();
  try {
    const config = buildCanonicalActualPostingRuntimeConfig(enabledEnv(context));
    const app = appFor(config, context.db);
    const body = { branchId: context.event.branchId, companyId: context.event.companyId };
    const first = await postJson(app, routePath(context.event.id), body);
    assert.equal(first.status, 200);
    const afterFirst = postingGraphSnapshot(context.db);

    const second = await postJson(app, routePath(context.event.id), body);
    assert.equal(second.status, 200);
    assert.equal(second.body.result.posting.outcome, 'EXACT_COMMITTED_RESULT');
    assert.equal(second.body.result.posting.replayed, true);
    assert.equal(postingGraphSnapshot(context.db), afterFirst);
    assert.deepEqual(primaryCounts(context.db), { audits: 1, operations: 1, receivables: 1 });
  } finally {
    context.db.close();
  }
});

test('PR9C posting failure rolls back the complete primary write set', async () => {
  const context = createPr9bContext();
  try {
    context.db.exec(`
      CREATE TRIGGER pr9c_forced_primary_failure
      BEFORE INSERT ON canonical_receivables
      BEGIN SELECT RAISE(ABORT, 'forced PR9C primary rollback'); END
    `);
    const before = postingGraphSnapshot(context.db);
    const config = buildCanonicalActualPostingRuntimeConfig(enabledEnv(context));
    const response = await postJson(
      appFor(config, context.db),
      routePath(context.event.id),
      { branchId: context.event.branchId, companyId: context.event.companyId },
    );
    assert.equal(response.status, 500);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.error.code, 'CANONICAL_POSTING_PERSISTENCE_FAILED');
    assert.equal(postingGraphSnapshot(context.db), before);
    assert.deepEqual(primaryCounts(context.db), { audits: 0, operations: 0, receivables: 0 });
  } finally {
    context.db.close();
  }
});

test('PR9C independent concurrent runtime invocations produce one winner and one exact replay', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr9c-runtime-concurrency-'));
  const dbPath = path.join(tempDir, 'runtime.sqlite');
  const context = createPr9bContext({ dbPath });
  const input = {
    dbPath,
    runtimeContractInput: context.runtimeContractInput,
    selector: selector(context),
  };
  context.db.close();

  try {
    const workers = [startWorker(input), startWorker(input)];
    await Promise.all(workers.map(worker => worker.ready));
    workers.forEach(worker => worker.child.send({ type: 'go' }));
    const messages = await Promise.all(workers.map(worker => worker.complete));
    assert.ok(messages.every(message => !message.error), JSON.stringify(messages));
    const outcomes = messages.map(message => message.result.posting.outcome).sort();
    assert.deepEqual(outcomes, ['EXACT_COMMITTED_RESULT', 'POSTED']);

    const observer = new Database(dbPath, { readonly: true });
    try {
      assert.deepEqual(primaryCounts(observer), { audits: 1, operations: 1, receivables: 1 });
      assert.equal(observer.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(observer.pragma('foreign_key_check'), []);
    } finally {
      observer.close();
    }
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});
