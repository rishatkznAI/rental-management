import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createPostingDenialStageFixture,
  createPr9bContext,
  postingCommand,
  postingGraphSnapshot,
  totalChanges,
} from './canonical-actual-posting-fixtures.js';

const workerPath = new URL('./helpers/canonical-actual-posting-concurrency-worker.mjs', import.meta.url);

function startWorker(input) {
  const child = fork(workerPath, [], {
    env: {
      ...process.env,
      PR9B_WORKER_INPUT: JSON.stringify(input),
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    const onMessage = message => {
      if (message?.type === 'ready') {
        child.off('message', onMessage);
        resolve();
      }
    };
    child.on('message', onMessage);
  });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.on('message', message => {
      if (message?.type === 'result') resolve(message);
    });
    child.once('exit', code => {
      if (code !== 0) reject(new Error(`PR9B worker exited ${code}`));
    });
  });
  return { child, ready, result };
}

async function runAtBarrier(inputs) {
  const workers = inputs.map(startWorker);
  await Promise.all(workers.map(worker => worker.ready));
  for (const worker of workers) worker.child.send({ type: 'go' });
  return Promise.all(workers.map(worker => worker.result));
}

function withTempDb(name, body) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `pr9b-${name}-`));
  const dbPath = path.join(directory, 'posting.sqlite');
  return Promise.resolve()
    .then(() => body(dbPath))
    .finally(() => fs.rmSync(directory, { force: true, recursive: true }));
}

test('PR9B independent processes serialize one primary winner and one exact follower', async () => {
  await withTempDb('primary-race', async dbPath => {
    const context = createPr9bContext({ dbPath });
    try {
      context.db.pragma('busy_timeout = 10000');
      const commandA = postingCommand(context);
      const commandB = JSON.stringify(Object.fromEntries(Object.entries(commandA).reverse()), null, 2);
      const results = await runAtBarrier([
        { command: commandA, dbPath, entrypoint: 'posting', runtimeContractInput: context.runtimeContractInput },
        { command: commandB, dbPath, entrypoint: 'posting', runtimeContractInput: context.runtimeContractInput },
      ]);
      assert.deepEqual(results.map(result => result.error), [undefined, undefined]);
      assert.deepEqual(
        results.map(result => result.result.outcome).sort(),
        ['EXACT_COMMITTED_RESULT', 'POSTED'],
      );
      assert.deepEqual(results.map(result => result.dml).sort((a, b) => a - b), [0, 3]);
      const winner = results.find(result => result.result.outcome === 'POSTED').result;
      const follower = results.find(result => result.result.outcome === 'EXACT_COMMITTED_RESULT').result;
      assert.deepEqual(follower.evidence, winner.evidence);
      assert.equal(Number(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivables').get().count), 1);
      assert.equal(Number(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_operations').get().count), 1);
      assert.equal(Number(context.db.prepare('SELECT COUNT(*) AS count FROM financial_audit_events').get().count), 1);
      assert.equal(Number(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflicts').get().count), 0);
      assert.deepEqual(context.db.pragma('foreign_key_check'), []);
    } finally {
      context.db.close();
    }
  });
});

for (const stage of ['PENDING', 'ACCOUNTED', 'CIRCUIT_APPLIED', 'COMPLETE']) {
  test(`PR9B independent cold seam readers preserve ${stage} and perform zero DML`, async () => {
    await withTempDb(`seam-${stage.toLowerCase()}`, async dbPath => {
      const context = createPostingDenialStageFixture(stage, { dbPath });
      try {
        context.db.pragma('busy_timeout = 10000');
        const commandA = postingCommand(context);
        const commandB = JSON.stringify(Object.fromEntries(Object.entries(commandA).reverse()), null, 2);
        const conflict = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
        const base = {
          assertedDenialCause: conflict.conflictType,
          denialAttemptId: conflict.denialAttemptId,
        };
        const graphBefore = postingGraphSnapshot(context.db);
        const parentChanges = totalChanges(context.db);
        const results = await runAtBarrier([
          {
            command: { ...base, postingCommand: commandA },
            dbPath,
            entrypoint: 'seam',
            runtimeContractInput: context.runtimeContractInput,
          },
          {
            command: { ...base, postingCommand: commandB },
            dbPath,
            entrypoint: 'seam',
            runtimeContractInput: context.runtimeContractInput,
          },
        ]);
        assert.deepEqual(results.map(result => result.error), [undefined, undefined]);
        assert.deepEqual(results.map(result => result.dml), [0, 0]);
        assert.deepEqual(results[1].result, results[0].result);
        assert.equal(results[0].result.evidence.stage, stage);
        assert.deepEqual(
          {
            classification: results[0].result.classification,
            outcome: results[0].result.outcome,
          },
          stage === 'COMPLETE'
            ? { classification: 'C5', outcome: 'EXACT_CONFLICT_REPLAY' }
            : { classification: 'C7', outcome: 'CONFLICT_RECOVERY_REQUIRED' },
        );
        assert.equal(totalChanges(context.db) - parentChanges, 0);
        assert.equal(postingGraphSnapshot(context.db), graphBefore);
      } finally {
        context.db.close();
      }
    });
  });
}
