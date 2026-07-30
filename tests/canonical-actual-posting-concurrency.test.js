import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createPostingDenialStageFixture,
  createPr9bContext,
  mutatePr8CandidateForPostingConflict,
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
  function waitFor(type) {
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      const onMessage = message => {
        if (message?.type === type) {
          child.off('message', onMessage);
          resolve(message);
        }
      };
      child.on('message', onMessage);
    });
  }
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.on('message', message => {
      if (message?.type === 'result') resolve(message);
    });
    child.once('exit', code => {
      if (code !== 0) reject(new Error(`PR9B worker exited ${code}`));
    });
  });
  return { child, ready, result, waitFor };
}

async function waitForFile(file, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function contentionProtocol(directory, prefix) {
  return {
    begin_immediate_attempted: path.join(directory, `${prefix}-begin-attempted`),
    lock_acquired: path.join(directory, `${prefix}-lock-acquired`),
    protected_stage_reached: path.join(directory, `${prefix}-protected-stage`),
    release_completed: path.join(directory, `${prefix}-release-completed`),
    repository_entrypoint_invoked: path.join(directory, `${prefix}-entrypoint-invoked`),
  };
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

for (const stage of ['PENDING', 'ACCOUNTED', 'CIRCUIT_APPLIED', 'COMPLETE']) {
  for (const writerEntrypoint of ['wrapper', 'seam']) {
    test(`P2-02 ${writerEntrypoint} writer and ${writerEntrypoint === 'wrapper' ? 'seam' : 'wrapper'} follower serialize at ${stage}`, async () => {
      await withTempDb(`c8-${writerEntrypoint}-${stage.toLowerCase()}`, async dbPath => {
        const context = createPr9bContext({ dbPath });
        try {
          mutatePr8CandidateForPostingConflict(context);
          const command = postingCommand(context);
          const seamCommand = {
            assertedDenialCause: 'PR8_EVIDENCE_MISMATCH',
            denialAttemptId: '41000000-0000-4000-8000-000000000001',
            postingCommand: command,
          };
          const deniedAttemptedAt = new Date(Date.parse(context.event.createdAt) + 1).toISOString();
          const beforeReached = path.join(path.dirname(dbPath), 'before-reached');
          const beforeRelease = path.join(path.dirname(dbPath), 'before-release');
          const afterReached = path.join(path.dirname(dbPath), 'after-reached');
          const afterRelease = path.join(path.dirname(dbPath), 'after-release');
          const barriers = {
            before: {
              [stage]: { reachedPath: beforeReached, releasePath: beforeRelease },
            },
            after: {
              [stage]: { reachedPath: afterReached, releasePath: afterRelease },
            },
          };
          const common = {
            clockMs: Date.parse(deniedAttemptedAt),
            command: seamCommand,
            dbPath,
            deniedAttemptedAt,
            runtimeContractInput: context.runtimeContractInput,
          };
          const writer = startWorker({ ...common, barriers, entrypoint: writerEntrypoint });
          await writer.ready;
          writer.child.send({ type: 'go' });
          await waitForFile(beforeReached);

          const followerEntrypoint = writerEntrypoint === 'wrapper' ? 'seam' : 'wrapper';
          const protocolPaths = contentionProtocol(
            path.dirname(dbPath),
            `follower-${writerEntrypoint}-${stage.toLowerCase()}`,
          );
          const follower = startWorker({
            ...common,
            entrypoint: followerEntrypoint,
            protocolPaths,
          });
          await follower.ready;
          follower.child.send({ type: 'go' });
          await waitForFile(protocolPaths.repository_entrypoint_invoked);
          await waitForFile(protocolPaths.begin_immediate_attempted);
          assert.equal(fs.existsSync(protocolPaths.lock_acquired), false);
          assert.equal(fs.existsSync(protocolPaths.protected_stage_reached), false);

          fs.writeFileSync(beforeRelease, 'release');
          await waitForFile(afterReached);
          await waitForFile(protocolPaths.lock_acquired);
          await waitForFile(protocolPaths.protected_stage_reached);
          const followerResult = await follower.result;
          fs.writeFileSync(afterRelease, 'release');
          const writerResult = await writer.result;
          assert.equal(followerResult.error, undefined);
          assert.equal(followerResult.dml, 0);
          if (followerEntrypoint === 'seam') {
            assert.deepEqual(
              {
                classification: followerResult.result.classification,
                outcome: followerResult.result.outcome,
                stage: followerResult.result.evidence.stage,
              },
              stage === 'COMPLETE'
                ? {
                  classification: writerEntrypoint === 'wrapper' ? 'C6' : 'C5',
                  outcome: writerEntrypoint === 'wrapper'
                    ? 'CONFLICT_RESULT_MISMATCH'
                    : 'EXACT_CONFLICT_REPLAY',
                  stage,
                }
                : { classification: 'C7', outcome: 'CONFLICT_RECOVERY_REQUIRED', stage },
            );
          } else {
            assert.deepEqual(
              {
                classification: followerResult.result.classification,
                outcome: followerResult.result.outcome,
                stage: followerResult.result.evidence.stage,
              },
              stage === 'COMPLETE'
                ? { classification: 'CONFLICT_COMPLETED', outcome: 'CONFLICT_COMPLETED', stage }
                : {
                  classification: 'CONFLICT_RECOVERY_INCOMPLETE',
                  outcome: 'CONFLICT_RECOVERY_REQUIRED',
                  stage,
                },
            );
          }
          assert.equal(writerResult.error, undefined);
          assert.equal(writerResult.dml, 6);
          if (writerEntrypoint === 'seam') {
            assert.equal(writerResult.result.outcome, 'DENIAL_PERSISTED');
            assert.equal(writerResult.result.evidence.stage, 'COMPLETE');
          } else {
            assert.equal(writerResult.result.outcome, 'DENIAL_PERSISTED');
            assert.equal(writerResult.result.evidence.stage, 'COMPLETE');
          }
          assert.equal(Number(context.db.prepare(
            'SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflicts',
          ).get().count), 1);
          assert.equal(Number(context.db.prepare(
            'SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflict_transitions',
          ).get().count), 1);
          assert.equal(context.db.prepare(
            'SELECT state FROM canonical_receivable_posting_conflict_transitions',
          ).get().state, 'COMPLETE');
          assert.equal(Number(context.db.prepare(
            'SELECT COUNT(*) AS count FROM canonical_receivable_posting_operations',
          ).get().count), 0);
          assert.equal(Number(context.db.prepare(
            'SELECT COUNT(*) AS count FROM canonical_receivables',
          ).get().count), 0);
          assert.equal(Number(context.db.prepare(
            'SELECT COUNT(*) AS count FROM financial_audit_events',
          ).get().count), 0);
          assert.deepEqual(context.db.pragma('foreign_key_check'), []);
        } finally {
          context.db.close();
        }
      });
    });
  }
}

for (const stage of ['PENDING', 'ACCOUNTED', 'CIRCUIT_APPLIED', 'COMPLETE']) {
  test(`PR9B ${stage} locked snapshot serializes the full reconcile matrix`, async () => {
    await withTempDb(`reconcile-${stage.toLowerCase()}`, async dbPath => {
      const context = createPostingDenialStageFixture(stage, { dbPath });
    try {
      const transitionId = context.db.prepare(
        'SELECT transitionId FROM canonical_receivable_posting_conflict_transitions',
      ).get().transitionId;
      const snapshotReached = path.join(path.dirname(dbPath), 'snapshot-reached');
      const snapshotRelease = path.join(path.dirname(dbPath), 'snapshot-release');
      const reader = startWorker({
        barrierPhase: 'snapshot',
        barrierReachedPath: snapshotReached,
        barrierReleasePath: snapshotRelease,
        barrierStage: stage,
        command: context.seamCommand,
        dbPath,
        entrypoint: 'seam',
        runtimeContractInput: context.runtimeContractInput,
      });
      await reader.ready;
      reader.child.send({ type: 'go' });
      await waitForFile(snapshotReached);

      const protocolPaths = contentionProtocol(
        path.dirname(dbPath),
        `reconciler-${stage.toLowerCase()}`,
      );
      const reconciler = startWorker({
        command: { transitionId },
        dbPath,
        entrypoint: 'reconcile',
        protocolPaths,
        runtimeContractInput: context.runtimeContractInput,
      });
      await reconciler.ready;
      reconciler.child.send({ type: 'go' });
      await waitForFile(protocolPaths.repository_entrypoint_invoked);
      await waitForFile(protocolPaths.begin_immediate_attempted);
      assert.equal(fs.existsSync(protocolPaths.lock_acquired), false);
      assert.equal(fs.existsSync(protocolPaths.protected_stage_reached), false);

      fs.writeFileSync(snapshotRelease, 'release');
      const readerResult = await reader.result;
      assert.equal(readerResult.error, undefined);
      assert.equal(readerResult.dml, 0);
      assert.equal(readerResult.result.classification, stage === 'COMPLETE' ? 'C5' : 'C7');
      assert.equal(
        readerResult.result.outcome,
        stage === 'COMPLETE' ? 'EXACT_CONFLICT_REPLAY' : 'CONFLICT_RECOVERY_REQUIRED',
      );
      assert.equal(readerResult.result.evidence.stage, stage);
      await waitForFile(protocolPaths.lock_acquired);
      await waitForFile(protocolPaths.protected_stage_reached);
      const reconcilerResult = await reconciler.result;
      assert.equal(reconcilerResult.error, undefined);
      assert.equal(reconcilerResult.dml, {
        PENDING: 4,
        ACCOUNTED: 2,
        CIRCUIT_APPLIED: 1,
        COMPLETE: 0,
      }[stage]);
      assert.equal(reconcilerResult.result.transition.state, 'COMPLETE');
      assert.equal(context.db.prepare(
        'SELECT state FROM canonical_receivable_posting_conflict_transitions',
      ).get().state, 'COMPLETE');
      assert.equal(Number(context.db.prepare(
        'SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflicts',
      ).get().count), 1);
      assert.equal(Number(context.db.prepare(
        'SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflict_transitions',
      ).get().count), 1);
      assert.equal(Number(context.db.prepare(
        'SELECT COUNT(*) AS count FROM canonical_receivable_posting_operations',
      ).get().count), 0);
      assert.equal(Number(context.db.prepare(
        'SELECT COUNT(*) AS count FROM canonical_receivables',
      ).get().count), 0);
      assert.equal(Number(context.db.prepare(
        'SELECT COUNT(*) AS count FROM financial_audit_events',
      ).get().count), 0);
      assert.deepEqual(context.db.pragma('foreign_key_check'), []);
    } finally {
      context.db.close();
    }
    });
  });
}
