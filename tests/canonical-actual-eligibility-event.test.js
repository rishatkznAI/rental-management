import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import {
  authorityRecord,
  createPr9aContext,
  eligibilityCommand,
} from './canonical-actual-posting-fixtures.js';

const require = createRequire(import.meta.url);
const repositoryPath = require.resolve('../server/lib/canonical-actual-eligibility-event-repository.js');
const {
  ERROR_CODES,
  canonicalJson,
  validateEligibleEventRecord,
} = require('../server/lib/canonical-actual-posting-domain.js');

function counts(db) {
  return {
    events: Number(db.prepare('SELECT COUNT(*) AS count FROM actual_receivable_eligible_events').get().count),
    conflicts: Number(db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflicts').get().count),
    transitions: Number(db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflict_transitions').get().count),
    receivables: Number(db.prepare("SELECT COUNT(*) AS count FROM canonical_receivables WHERE sourceSystem = 'rentcore.billing_source_authority.v1'").get().count),
    operations: Number(db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_operations').get().count),
  };
}

function replaceFunction(object, property, value) {
  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  Object.defineProperty(object, property, { ...descriptor, value });
  return () => Object.defineProperty(object, property, descriptor);
}

function freshRepositoryWith(context, install) {
  const restore = install();
  delete require.cache[repositoryPath];
  try {
    const { createCanonicalActualEligibilityEventRepository } = require(repositoryPath);
    return createCanonicalActualEligibilityEventRepository(context.db);
  } finally {
    restore();
    delete require.cache[repositoryPath];
  }
}

function mutateCandidateForConflict(context) {
  const trigger = context.db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name = 'trg_actual_source_dry_run_candidates_no_update'
  `).get();
  context.db.exec(`DROP TRIGGER ${trigger.name}`);
  context.db.prepare('UPDATE actual_source_dry_run_candidates SET dueDateEvidenceRef = ? WHERE id = ?')
    .run('contract-due-date-conflict-v2', context.authority.candidate.id);
  context.db.exec(trigger.sql);
}

function nextAuthority(previous, version, overrides = {}) {
  const { recordHash: _recordHash, ...previousWithoutHash } = previous;
  return authorityRecord({
    kind: previous.authorityKind,
    ownershipHash: previous.sourceOwnershipManifestHash,
    overrides: {
      ...previousWithoutHash,
      recordId: `authority-record-${previous.authorityKind}-v${version}`,
      authorityVersion: version,
      previousRecordId: previous.recordId,
      createdAt: `2026-07-27T10:${String(version).padStart(2, '0')}:00.000Z`,
      ...overrides,
    },
  });
}

function produceConflict(context) {
  context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
  mutateCandidateForConflict(context);
  let error;
  try {
    context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  return error;
}

function runWorker(dbPath, command) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./helpers/canonical-actual-eligibility-concurrency-worker.mjs', import.meta.url),
      { workerData: { dbPath, command } },
    );
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
}

test('Algorithm A creates one deterministic eligibility event and never performs canonical business DML', () => {
  const context = createPr9aContext();
  try {
    const result = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    assert.equal(result.replayed, false);
    assert.equal(result.event.eventSchemaVersion, 'ActualReceivableEligibleV1');
    assert.equal(result.event.eventVersion, 1);
    assert.equal(result.event.schemaVersion, 1);
    assert.equal(result.event.occurredAt, result.event.createdAt);
    assert.equal(result.event.companyTimezoneSnapshot, 'Europe/Moscow');
    assert.equal(result.event.writeAuthorizationRecordId, context.authority.authorization.recordId);
    assert.equal(validateEligibleEventRecord(result.event).eventHash, result.event.eventHash);
    assert.deepEqual(counts(context.db), {
      events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
    });
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.db.close();
  }
});

test('Algorithm A exact event replay is read-only and returns byte-identical persisted fields', () => {
  const context = createPr9aContext();
  try {
    const first = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    const before = counts(context.db);
    const replay = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    assert.equal(replay.replayed, true);
    assert.equal(canonicalJson(replay.event), canonicalJson(first.event));
    assert.deepEqual(counts(context.db), before);
  } finally {
    context.db.close();
  }
});

test('Algorithm A applies source-before-producer global authority precedence and persists exact frozen denial evidence', () => {
  const context = createPr9aContext();
  try {
    const sourceDescendant = nextAuthority(context.authority.source, 2);
    const producerDescendant = nextAuthority(context.authority.producer, 2);
    context.authority.repository.appendAuthorityRecord(producerDescendant);
    context.authority.repository.appendAuthorityRecord(sourceDescendant);

    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => {
        assert.equal(error.code, 'SOURCE_ADAPTER_LATEST_CHAIN_MISMATCH');
        assert.equal(error.replayed, false);
        assert.equal(error.conflict.deniedAuthorityKind, 'source_adapter');
        assert.equal(error.conflict.deniedAuthorityRecordId, sourceDescendant.recordId);
        assert.equal(error.conflict.deniedAuthorityVersion, 2);
        assert.equal(error.conflict.deniedAuthorityRecordHash, sourceDescendant.recordHash);
        assert.equal(error.conflict.economicLineageKey, null);
        assert.equal(error.conflict.economicSourceRevisionKey, null);
        return true;
      },
    );

    assert.deepEqual(counts(context.db), {
      events: 0, conflicts: 1, transitions: 1, receivables: 0, operations: 0,
    });
    const conflict = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
    const observation = JSON.parse(conflict.conflictObservationJson);
    const projectionKeys = [
      'actorId', 'artifactIdentityHash', 'authorityId', 'authorityKind',
      'authorityRecordId', 'authorityVersion', 'bindingState', 'configurationHash',
      'denialAttemptId', 'deniedAttemptedAt', 'effectiveFrom', 'effectiveUntil',
      'latestRecordHash', 'ownershipManifestHash', 'policyHash',
      'postingAuthorityChainSnapshotHash', 'producerAuthorityChainSnapshotHash',
      'recordHash', 'scopeFingerprint', 'sourceAuthorityChainSnapshotHash',
      'stateCode', 'status', 'temporalEvaluationState', 'temporalWindowFingerprint',
    ].sort();
    assert.deepEqual(Object.keys(observation.expectedProjection).sort(), projectionKeys);
    assert.deepEqual(Object.keys(observation.observedProjection).sort(), projectionKeys);
    assert.equal(observation.expectedProjection.authorityRecordId, context.authority.source.recordId);
    assert.equal(observation.observedProjection.authorityRecordId, sourceDescendant.recordId);
    assert.equal(observation.observedProjection.stateCode, 'LATEST_CHAIN_MISMATCH');
    assert.equal(JSON.parse(conflict.sourceAuthorityChainSnapshotJson).precedenceState, 'selected');
    assert.equal(JSON.parse(conflict.producerAuthorityChainSnapshotJson).precedenceState, 'suppressed_by_higher_kind');
    assert.equal(JSON.parse(conflict.postingAuthorityChainSnapshotJson).precedenceState, 'unaffected_active_latest');
    assert.equal(
      context.db.prepare('SELECT state FROM canonical_receivable_posting_conflict_transitions').get().state,
      'COMPLETE',
    );
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.db.close();
  }
});

test('later expired authority descendant is unrepresentable and performs zero conflict or event DML', () => {
  const context = createPr9aContext();
  try {
    const expiredDescendant = nextAuthority(context.authority.source, 2, {
      status: 'expired',
      revocationReasonCode: 'expired-descendant-fixture',
    });
    context.authority.repository.appendAuthorityRecord(expiredDescendant);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === 'AUTHORITY_LATEST_EXPIRED_DESCENDANT_UNREPRESENTABLE_V1',
    );
    assert.deepEqual(counts(context.db), {
      events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
    });
  } finally {
    context.db.close();
  }
});

test('command validation and repository UUID/clock failures perform zero DML with stable literals', () => {
  const invalid = createPr9aContext();
  try {
    assert.throws(
      () => invalid.eligibilityService.produceEligibleEvent({ ...eligibilityCommand(invalid), callerId: 'forbidden' }),
      error => error.code === ERROR_CODES.ENVELOPE_INVALID,
    );
    assert.deepEqual(counts(invalid.db), { events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0 });
  } finally {
    invalid.db.close();
  }

  const badUuid = createPr9aContext();
  try {
    const repository = freshRepositoryWith(badUuid, () => replaceFunction(crypto, 'randomUUID', () => 'not-a-uuid'));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(badUuid)),
      error => error.code === ERROR_CODES.DENIAL_ATTEMPT_ID_GENERATION_FAILED,
    );
    assert.deepEqual(counts(badUuid.db), { events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0 });
  } finally {
    badUuid.db.close();
  }

  const badClock = createPr9aContext();
  try {
    const repository = freshRepositoryWith(badClock, () => replaceFunction(Date, 'now', () => { throw new Error('clock failed'); }));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(badClock)),
      error => error.code === 'CANONICAL_REPOSITORY_CLOCK_FAILED',
    );
    assert.deepEqual(counts(badClock.db), { events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0 });
  } finally {
    badClock.db.close();
  }
});

test('event insert failure rolls back the complete Algorithm A transaction', () => {
  const context = createPr9aContext();
  try {
    context.db.exec(`
      CREATE TRIGGER pr9_test_abort_event_insert
      BEFORE INSERT ON actual_receivable_eligible_events
      BEGIN SELECT RAISE(ABORT, 'test forced rollback'); END;
    `);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === 'CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED',
    );
    assert.deepEqual(counts(context.db), { events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0 });
  } finally {
    context.db.close();
  }
});

test('required denial commits a reciprocal pair, synchronously reaches COMPLETE, and returns only afterward', () => {
  const context = createPr9aContext();
  try {
    const error = produceConflict(context);
    assert.equal(error.code, 'ECONOMIC_SOURCE_EVENT_MISMATCH');
    assert.equal(error.replayed, false);
    assert.ok(error.conflict);
    const observation = JSON.parse(error.conflict.conflictObservationJson);
    for (const key of [
      'denialAttemptId', 'deniedAttemptedAt', 'postingAdapterAuthorityBranchId',
      'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityKind',
      'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityRecordId',
      'postingAdapterAuthorityVersion', 'postingAuthorityChainSnapshotHash',
      'producerAuthorityBranchId', 'producerAuthorityCompanyId', 'producerAuthorityKind',
      'producerAuthorityRecordHash', 'producerAuthorityRecordId', 'producerAuthorityVersion',
      'producerAuthorityChainSnapshotHash', 'sourceAuthorityChainSnapshotHash',
    ]) {
      assert.ok(Object.hasOwn(observation.expectedProjection, key), key);
      assert.equal(observation.expectedProjection[key], observation.observedProjection[key], key);
    }
    const transition = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflict_transitions').get();
    assert.deepEqual(
      { state: transition.state, attemptApplied: transition.attemptApplied, rateApplied: transition.rateApplied, circuitApplied: transition.circuitApplied },
      { state: 'COMPLETE', attemptApplied: 1, rateApplied: 1, circuitApplied: 1 },
    );
    const pair = context.eligibilityRepository.readConflictPair(transition.transitionId);
    assert.equal(pair.conflict.id, transition.conflictId);
    assert.equal(pair.conflict.transitionId, transition.transitionId);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.db.close();
  }
});

test('pair-commit crash simulation blocks admission until idempotent synchronous recovery completes', () => {
  const context = createPr9aContext();
  try {
    context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    mutateCandidateForConflict(context);
    context.db.exec(`
      CREATE TRIGGER pr9_test_abort_transition_stage
      BEFORE UPDATE ON canonical_receivable_posting_conflict_transitions
      BEGIN SELECT RAISE(ABORT, 'test stage crash'); END;
    `);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED,
    );
    const pending = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflict_transitions').get();
    assert.equal(pending.state, 'PENDING');
    assert.equal(pending.attemptApplied, 0);
    const beforeBlocked = counts(context.db);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED,
    );
    assert.deepEqual(counts(context.db), beforeBlocked);
    context.db.exec('DROP TRIGGER pr9_test_abort_transition_stage');
    const complete = context.eligibilityRepository.reconcileTransition(pending.transitionId);
    assert.equal(complete.transition.state, 'COMPLETE');
    const beforeReplay = canonicalJson(context.db.prepare(
      'SELECT * FROM canonical_receivable_posting_conflict_transitions WHERE transitionId = ?',
    ).get(pending.transitionId));
    const repeated = context.eligibilityRepository.reconcileTransition(pending.transitionId);
    assert.equal(repeated.transition.state, 'COMPLETE');
    const afterReplay = canonicalJson(context.db.prepare(
      'SELECT * FROM canonical_receivable_posting_conflict_transitions WHERE transitionId = ?',
    ).get(pending.transitionId));
    assert.equal(afterReplay, beforeReplay);
  } finally {
    context.db.close();
  }
});

test('self-consistent denial UUID collision and corrupted persisted pair are distinct fail-closed results', () => {
  const collision = createPr9aContext();
  try {
    produceConflict(collision);
    const conflict = collision.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
    const repository = freshRepositoryWith(collision, () => replaceFunction(crypto, 'randomUUID', () => conflict.denialAttemptId));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(collision)),
      error => error.code === ERROR_CODES.DENIAL_ATTEMPT_ID_COLLISION,
    );
    assert.equal(counts(collision.db).conflicts, 1);
  } finally {
    collision.db.close();
  }

  const corrupted = createPr9aContext();
  try {
    produceConflict(corrupted);
    const conflict = corrupted.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
    const trigger = corrupted.db.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' AND tbl_name = 'canonical_receivable_posting_conflicts'
        AND name LIKE '%no_update'
    `).get();
    corrupted.db.exec(`DROP TRIGGER ${trigger.name}`);
    corrupted.db.prepare('UPDATE canonical_receivable_posting_conflicts SET eventHash = ? WHERE id = ?')
      .run('0'.repeat(64), conflict.id);
    corrupted.db.exec(trigger.sql);
    const repository = freshRepositoryWith(corrupted, () => replaceFunction(crypto, 'randomUUID', () => conflict.denialAttemptId));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(corrupted)),
      error => error.code === ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED,
    );
    assert.equal(counts(corrupted.db).conflicts, 1);
  } finally {
    corrupted.db.close();
  }
});

test('31 direct denial candidates commit at most 30 pairs and the 31st is blocked before pair DML', () => {
  const context = createPr9aContext();
  try {
    context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    mutateCandidateForConflict(context);
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      assert.throws(
        () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
        error => error.code === 'ECONOMIC_SOURCE_EVENT_MISMATCH',
      );
    }
    assert.equal(counts(context.db).conflicts, 30);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === ERROR_CODES.CONFLICT_EVIDENCE_PERSISTENCE_FAILED,
    );
    assert.equal(counts(context.db).conflicts, 30);
    assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflict_transitions WHERE state = 'COMPLETE'").get().count, 30);
  } finally {
    context.db.close();
  }
});

test('concurrent Algorithm A execution serializes to one event and one exact replay', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr9a-concurrency-'));
  const dbPath = path.join(directory, 'fixture.sqlite');
  const context = createPr9aContext({ dbPath });
  const command = eligibilityCommand(context);
  context.db.close();
  try {
    const results = await Promise.all([runWorker(dbPath, command), runWorker(dbPath, command)]);
    assert.ok(results.every(result => result.ok), JSON.stringify(results));
    assert.deepEqual(results.map(result => result.id), [results[0].id, results[0].id]);
    assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
