import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  closePlan,
  conductPlan,
  createBillingSourceContext,
  formPlan,
  hash,
  insertActivationBoundary,
  openExistingBillingSourceContext,
} from './billing-source-authority-fixtures.js';

const workerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'billing-source-authority-concurrency-worker.mjs',
);

function replacementCommand(context, predecessorId, suffix) {
  const upd = context.db.prepare('SELECT * FROM billing_source_upds ORDER BY createdAt, id LIMIT 1').get();
  const latestUpdVersion = context.db.prepare(`
    SELECT * FROM billing_source_upd_versions
    WHERE updId = ? ORDER BY version DESC, id DESC LIMIT 1
  `).get(upd.id);
  const line = context.db.prepare('SELECT * FROM billing_source_upd_lines WHERE updId = ?').get(upd.id);
  const lineVersion = context.db.prepare(`
    SELECT * FROM billing_source_upd_line_versions
    WHERE updLineId = ? ORDER BY version DESC, id DESC LIMIT 1
  `).get(line.id);
  return {
    operationType: 'correct_upd',
    idempotencyKey: `concurrent-replacement-${suffix}`,
    updId: upd.id,
    expectedUpdVersion: Number(latestUpdVersion.version),
    action: 'replace',
    reasonCode: 'CONCURRENT_REPLACEMENT',
    reasonText: `Concurrent replacement ${suffix}`,
    sourceEventId: `concurrent-replacement-event-${suffix}`,
    sourceEventVersion: 1,
    sourceHash: hash(`concurrent-replacement-event-${suffix}`),
    lines: [{
      id: line.id,
      sourceLineRef: line.sourceLineRef,
      sourceLineIdentityKind: line.sourceLineIdentityKind,
      displayPosition: 2,
      description: `Concurrent corrected line ${suffix}`,
      quantityValueInteger: 1,
      quantityScale: 0,
      unitCode: 'service',
      currency: 'RUB',
      netMinor: 100_000,
      vatMinor: 20_000,
      grossMinor: 120_000,
      vatPolicyRef: 'vat-policy-test-v1',
      roundingPolicyRef: 'rounding-policy-test-v1',
      policyDecisionRef: 'policy-decision-test-v1',
      sourceIntegrityStatus: 'matched',
      blockerReasonCodes: [],
      sourceSystem: 'isolated_test_adapter',
      sourceRef: line.sourceLineRef,
      sourceVersion: Number(lineVersion.version) + 1,
      sourceHash: hash(`concurrent-replacement-line-${suffix}`),
    }],
    coverage: {
      ...formPlan(context).coverage,
      supersedesCoverageSetIds: [predecessorId],
    },
  };
}

function spawnAttempt(dbPath, attempt, index) {
  const child = fork(workerPath, [dbPath, String(index)], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  let readyResolve;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    child.once('error', reject);
  });
  const result = new Promise((resolve, reject) => {
    child.on('message', message => {
      if (message?.type === 'ready') {
        readyResolve();
        return;
      }
      if (typeof message?.ok === 'boolean') resolve(message);
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code !== 0) reject(new Error(`Concurrency worker ${index} exited ${code}: ${stderr}`));
    });
  });
  return { child, ready, result, attempt };
}

async function runConcurrently(dbPath, attempts) {
  const actors = attempts.map((attempt, index) => spawnAttempt(dbPath, attempt, index));
  await Promise.all(actors.map(actor => actor.ready));
  for (const actor of actors) actor.child.send({ type: 'run', ...actor.attempt });
  return Promise.all(actors.map(actor => actor.result));
}

function activeCoverageCount(db) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM billing_source_coverage_sets coverage
    WHERE coverage.status = 'validated'
      AND NOT EXISTS (
        SELECT 1 FROM billing_source_coverage_supersessions lifecycle
        WHERE lifecycle.originalCoverageSetId = coverage.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM billing_source_upd_versions terminal
        WHERE terminal.updId = coverage.updId
          AND terminal.version = (
            SELECT MAX(latest.version) FROM billing_source_upd_versions latest
            WHERE latest.updId = coverage.updId
          )
          AND terminal.state IN ('cancelled', 'corrected')
      )
  `).get().count;
}

function assertOneWinner(results, loserCode) {
  assert.equal(results.filter(result => result.ok).length, 1, JSON.stringify(results));
  const loser = results.find(result => !result.ok);
  assert.equal(loser.code, loserCode, JSON.stringify(results));
  assert.doesNotMatch(loser.message, /SQLITE_BUSY|database is locked/i);
}

function withTempDatabase(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-source-concurrency-'));
  const dbPath = path.join(directory, 'authority.sqlite');
  return Promise.resolve()
    .then(() => run(dbPath))
    .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

test('concurrent replacements of one predecessor have one winner and no partial or orphan lifecycle rows', () => withTempDatabase(async dbPath => {
  const context = createBillingSourceContext({ dbPath });
  insertActivationBoundary(context);
  context.service.closeBillingPeriod(context.commandContext, closePlan());
  context.service.formUpd(context.commandContext, formPlan(context));
  context.service.conductUpd(context.commandContext, conductPlan(context));
  const predecessor = context.db.prepare('SELECT id FROM billing_source_coverage_sets').get();
  const attempts = [
    { method: 'correctUpd', command: replacementCommand(context, predecessor.id, 'a') },
    { method: 'correctUpd', command: replacementCommand(context, predecessor.id, 'b') },
  ];
  context.close();

  const results = await runConcurrently(dbPath, attempts);
  assertOneWinner(results, 'BILLING_SOURCE_UPD_STALE');
  const inspection = openExistingBillingSourceContext(dbPath);
  try {
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_supersessions').get().count, 1);
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_sets').get().count, 2);
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_slices').get().count, 2);
    assert.equal(activeCoverageCount(inspection.db), 1);
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_operations').get().count, 4);
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_audit_events').get().count, 4);
    assert.equal(inspection.db.prepare(`
      SELECT COUNT(*) AS count
      FROM billing_source_coverage_supersessions lifecycle
      LEFT JOIN billing_source_coverage_sets replacement
        ON replacement.id = lifecycle.replacementCoverageSetId
      WHERE lifecycle.replacementCoverageSetId IS NOT NULL AND replacement.id IS NULL
    `).get().count, 0);
    assert.deepEqual(inspection.db.pragma('foreign_key_check'), []);
  } finally {
    inspection.close();
  }
}));

test('concurrent cancel and replacement have one winner with complete matching lifecycle, operation, and audit', () => withTempDatabase(async dbPath => {
  const context = createBillingSourceContext({ dbPath });
  insertActivationBoundary(context);
  context.service.closeBillingPeriod(context.commandContext, closePlan());
  context.service.formUpd(context.commandContext, formPlan(context));
  context.service.conductUpd(context.commandContext, conductPlan(context));
  const upd = context.db.prepare('SELECT id FROM billing_source_upds').get();
  const predecessor = context.db.prepare('SELECT id FROM billing_source_coverage_sets').get();
  const cancel = {
    operationType: 'correct_upd',
    idempotencyKey: 'concurrent-cancel',
    updId: upd.id,
    expectedUpdVersion: 3,
    action: 'cancel',
    reasonCode: 'CONCURRENT_CANCEL',
    reasonText: 'Concurrent cancellation',
    sourceEventId: 'concurrent-cancel-event',
    sourceEventVersion: 1,
    sourceHash: hash('concurrent-cancel-event'),
  };
  const attempts = [
    { method: 'correctUpd', command: cancel },
    { method: 'correctUpd', command: replacementCommand(context, predecessor.id, 'against-cancel') },
  ];
  context.close();

  const results = await runConcurrently(dbPath, attempts);
  assertOneWinner(results, 'BILLING_SOURCE_UPD_STALE');
  const inspection = openExistingBillingSourceContext(dbPath);
  try {
    const lifecycle = inspection.db.prepare('SELECT * FROM billing_source_coverage_supersessions').get();
    assert.ok(lifecycle);
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_operations').get().count, 4);
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_audit_events').get().count, 4);
    assert.equal(activeCoverageCount(inspection.db), lifecycle.action === 'cancelled' ? 0 : 1);
    assert.equal(
      inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_sets').get().count,
      lifecycle.action === 'cancelled' ? 1 : 2,
    );
    assert.equal(
      inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_slices').get().count,
      lifecycle.action === 'cancelled' ? 1 : 2,
    );
    assert.deepEqual(inspection.db.pragma('foreign_key_check'), []);
  } finally {
    inspection.close();
  }
}));

test('concurrent UPDs competing for one slice have one winner and one deterministic overlap conflict', () => withTempDatabase(async dbPath => {
  const context = createBillingSourceContext({ dbPath });
  insertActivationBoundary(context);
  context.service.closeBillingPeriod(context.commandContext, closePlan());
  context.service.formUpd(context.commandContext, formPlan(context, {
    idempotencyKey: 'concurrent-form-a',
    sourceDocumentRef: 'concurrent-upd-a',
    sourceLineRef: 'concurrent-upd-line-a',
    withoutCoverage: true,
  }));
  context.service.formUpd(context.commandContext, formPlan(context, {
    idempotencyKey: 'concurrent-form-b',
    sourceDocumentRef: 'concurrent-upd-b',
    sourceLineRef: 'concurrent-upd-line-b',
    withoutCoverage: true,
  }));
  const upds = context.db.prepare('SELECT * FROM billing_source_upds ORDER BY sourceDocumentRef').all();
  const attempts = upds.map((upd, index) => {
    const formed = context.db.prepare("SELECT * FROM billing_source_upd_versions WHERE updId = ? AND state = 'formed'").get(upd.id);
    const line = context.db.prepare('SELECT * FROM billing_source_upd_lines WHERE updId = ?').get(upd.id);
    return {
      method: 'recordUpdCoverage',
      command: {
        operationType: 'record_upd_coverage',
        idempotencyKey: `concurrent-coverage-${index}`,
        updId: upd.id,
        formedUpdVersionId: formed.id,
        expectedUpdVersion: 2,
        coverage: formPlan(context, {
          sourceLineRef: line.sourceLineRef,
          expectedCoverageVersion: 0,
        }).coverage,
        reasonCode: 'CONCURRENT_COVERAGE',
        reasonText: `Concurrent coverage ${index}`,
        sourceEventId: `concurrent-coverage-event-${index}`,
        sourceEventVersion: 1,
        sourceHash: hash(`concurrent-coverage-event-${index}`),
      },
    };
  });
  context.close();

  const results = await runConcurrently(dbPath, attempts);
  assertOneWinner(results, 'BILLING_SOURCE_COVERAGE_OVERLAP');
  const inspection = openExistingBillingSourceContext(dbPath);
  try {
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_sets').get().count, 1);
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_slices').get().count, 1);
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_supersessions').get().count, 0);
    assert.equal(activeCoverageCount(inspection.db), 1);
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_operations').get().count, 4);
    assert.equal(inspection.db.prepare('SELECT COUNT(*) AS count FROM billing_source_audit_events').get().count, 4);
    assert.deepEqual(inspection.db.pragma('foreign_key_check'), []);
  } finally {
    inspection.close();
  }
}));
