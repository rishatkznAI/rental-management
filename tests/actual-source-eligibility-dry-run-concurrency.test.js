import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  approvedTestPolicyManifest,
  createActualSourceDryRunContext,
  dryRunCommand,
  seedPositiveSource,
} from './actual-source-eligibility-dry-run-fixtures.js';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const worker = new URL('./helpers/actual-source-eligibility-dry-run-concurrency-worker.mjs', import.meta.url);

function runWorker(dbPath, command) {
  const encoded = Buffer.from(JSON.stringify(command)).toString('base64url');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker.pathname, dbPath, encoded], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      if (code !== 0) return reject(new Error(`worker exited ${code}: ${stderr}`));
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`worker returned invalid JSON: ${stdout}\n${stderr}\n${error.message}`));
      }
      return undefined;
    });
  });
}

function seededFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-pr8-concurrency-'));
  const dbPath = path.join(directory, 'app.sqlite');
  const context = createActualSourceDryRunContext({ dbPath });
  seedPositiveSource(context);
  context.close();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return dbPath;
}

function counts(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      runs: db.prepare('SELECT COUNT(*) AS count FROM actual_source_dry_runs').get().count,
      candidates: db.prepare('SELECT COUNT(*) AS count FROM actual_source_dry_run_candidates').get().count,
      operations: db.prepare('SELECT COUNT(*) AS count FROM actual_source_dry_run_operations').get().count,
      audits: db.prepare('SELECT COUNT(*) AS count FROM actual_source_dry_run_audit_events').get().count,
    };
  } finally {
    db.close();
  }
}

test('two independent SQLite connections produce one deterministic winner and one exact replay', async t => {
  const dbPath = seededFile(t);
  const command = dryRunCommand({ idempotencyKey: 'concurrent-identical' });
  const results = await Promise.all([runWorker(dbPath, command), runWorker(dbPath, command)]);
  assert.equal(results.every(result => result.ok), true, JSON.stringify(results));
  assert.equal(new Set(results.map(result => result.result.dryRunId)).size, 1);
  assert.equal(new Set(results.map(result => result.result.operationId)).size, 1);
  assert.deepEqual(results.map(result => result.result.replayed).sort(), [false, true]);
  assert.deepEqual(counts(dbPath), { runs: 1, candidates: 1, operations: 1, audits: 1 });
});

test('independent connections using one key with different policy produce one winner and one domain conflict', async t => {
  const dbPath = seededFile(t);
  const changed = approvedTestPolicyManifest({
    manifestId: 'isolated-test-pr8-policy-conflict',
    manifestVersion: 2,
    gates: {
      unknown_due_date_treatment: {
        decisionRef: 'isolated-test-unknown-due-v2',
        decisionVersion: 2,
        decisionHash: 'b'.repeat(64),
      },
    },
  });
  const results = await Promise.all([
    runWorker(dbPath, dryRunCommand({ idempotencyKey: 'concurrent-policy-conflict' })),
    runWorker(dbPath, dryRunCommand({
      idempotencyKey: 'concurrent-policy-conflict',
      policyManifest: changed,
    })),
  ]);
  assert.equal(results.filter(result => result.ok).length, 1, JSON.stringify(results));
  const loser = results.find(result => !result.ok);
  assert.equal(loser.code, 'ACTUAL_SOURCE_IDEMPOTENCY_CONFLICT');
  assert.equal(loser.sqliteCode, null);
  assert.deepEqual(counts(dbPath), { runs: 1, candidates: 1, operations: 1, audits: 1 });
});
