import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  appendAuthorityDescendant,
  createEvidenceTrace,
  createInstrumentedEligibilityRepository,
  createPostingDenialStageFixture,
  createPostingRepositoryForTest,
  createPr9bContext,
  mutatePr8CandidateForPostingConflict,
  mutateProtectedRow,
  postingCommand,
  postingGraphSnapshot,
  totalChanges,
} from './canonical-actual-posting-fixtures.js';

const require = createRequire(import.meta.url);
const eligibilityModule = require('../server/lib/canonical-actual-eligibility-event-repository.js');
const {
  computeGovernedAuthorityRecordHash,
} = require('../server/lib/canonical-actual-posting-domain.js');

const STAGES = ['PENDING', 'ACCOUNTED', 'CIRCUIT_APPLIED', 'COMPLETE'];
const ZERO_PRIMARY = Object.freeze({
  canonical_receivable_posting_operations: 0,
  canonical_receivables: 0,
  financial_audit_events: 0,
});

function primaryCounts(db) {
  return Object.fromEntries(Object.keys(ZERO_PRIMARY).map(table => [
    table,
    Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
  ]));
}

function expectedSeam(stage) {
  return stage === 'COMPLETE'
    ? { classification: 'C5', outcome: 'EXACT_CONFLICT_REPLAY' }
    : { classification: 'C7', outcome: 'CONFLICT_RECOVERY_REQUIRED' };
}

function instrumentPostCommitReads(db, afterCommit = null) {
  const originalExec = db.exec.bind(db);
  const originalPrepare = db.prepare.bind(db);
  const originalPragma = db.pragma.bind(db);
  let committed = false;
  let afterCommitSelectCount = 0;
  let afterCommitPragmaCount = 0;
  db.prepare = sql => {
    const statement = originalPrepare(sql);
    return new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (
          committed
          && ['all', 'get', 'iterate'].includes(property)
          && /^\s*(?:SELECT|WITH)\b/i.test(String(sql))
        ) {
          return (...args) => {
            afterCommitSelectCount += 1;
            return value.apply(target, args);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  db.pragma = (...args) => {
    if (committed) afterCommitPragmaCount += 1;
    return originalPragma(...args);
  };
  db.exec = sql => {
    const result = originalExec(sql);
    if (/^\s*COMMIT\s*;?\s*$/i.test(String(sql))) {
      if (afterCommit) afterCommit();
      committed = true;
    }
    return result;
  };
  return Object.freeze({
    counts() {
      return { afterCommitPragmaCount, afterCommitSelectCount };
    },
    restore() {
      db.exec = originalExec;
      db.prepare = originalPrepare;
      db.pragma = originalPragma;
    },
  });
}

function invokeWithPostCommitProof(db, invocation, afterCommit = null) {
  const proof = instrumentPostCommitReads(db, afterCommit);
  try {
    const result = invocation();
    assert.deepEqual(proof.counts(), {
      afterCommitPragmaCount: 0,
      afterCommitSelectCount: 0,
    });
    return result;
  } finally {
    proof.restore();
  }
}

function instrumentSqliteReadCount(db) {
  const originalPragma = db.pragma.bind(db);
  const originalPrepare = db.prepare.bind(db);
  let count = 0;
  db.prepare = sql => {
    const statement = originalPrepare(sql);
    return new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (['all', 'get', 'iterate'].includes(property)) {
          return (...args) => {
            count += 1;
            return value.apply(target, args);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  db.pragma = (...args) => {
    count += 1;
    return originalPragma(...args);
  };
  return Object.freeze({
    count: () => count,
    restore() {
      db.pragma = originalPragma;
      db.prepare = originalPrepare;
    },
  });
}

function rawColumn(entries, table, column) {
  for (const entry of entries) {
    if (entry.phase !== 'sqlite_raw_read' || entry.table !== table) continue;
    for (const row of entry.rows) {
      const found = row.columns.find(candidate => candidate.column === column);
      if (found) return found;
    }
  }
  return null;
}

test('PR9B denial-package capability is absent from constructor, repository, and module exports', () => {
  const context = createPr9bContext();
  try {
    assert.throws(
      () => eligibilityModule.createCanonicalActualEligibilityEventRepository(
        context.db,
        context.runtimeContract,
        { testOnlyBuildPostingDenialPackage: true },
      ),
      error => error.code === 'CANONICAL_ENVELOPE_INVALID',
    );
    const repository = createInstrumentedEligibilityRepository(context);
    assert.equal('__testBuildPostingDenialPackage' in repository, false);
    assert.equal(repository.__testBuildPostingDenialPackage, undefined);
    for (const key of Reflect.ownKeys(eligibilityModule).map(String)) {
      assert.doesNotMatch(key, /brand|denial.*package.*(?:factory|build)|freezeDenial|private/i);
    }
  } finally {
    context.db.close();
  }
});

test('PR9B structurally identical caller forgery cannot initiate Algorithm C durable DML', () => {
  const context = createPr9bContext();
  try {
    const repository = createInstrumentedEligibilityRepository(context);
    const forged = Object.freeze({
      conflictCandidateProjection: Object.freeze({}),
      conflictHashCandidate: '0'.repeat(64),
      conflictObservationHash: '0'.repeat(64),
      conflictType: 'PR8_EVIDENCE_MISMATCH',
      denialAttemptId: '11111111-1111-4111-8111-111111111111',
      deniedAttemptedAt: context.event.createdAt,
      expectedFingerprint: '0'.repeat(64),
      expectedProjection: Object.freeze({}),
      observedFingerprint: '0'.repeat(64),
      observedProjection: Object.freeze({}),
      postingAuthorityChainSnapshot: Object.freeze({}),
      postingAuthorityChainSnapshotHash: '0'.repeat(64),
      producerAuthorityChainSnapshot: Object.freeze({}),
      producerAuthorityChainSnapshotHash: '0'.repeat(64),
      sourceAuthorityChainSnapshot: Object.freeze({}),
      sourceAuthorityChainSnapshotHash: '0'.repeat(64),
    });
    const before = totalChanges(context.db);
    assert.throws(
      () => repository.persistDenialEvidence(forged),
      error => error.code === 'CANONICAL_CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED',
    );
    assert.equal(totalChanges(context.db) - before, 0);
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY);
    assert.equal(Number(context.db.prepare(
      'SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflicts',
    ).get().count), 0);
  } finally {
    context.db.close();
  }
});

test('PR9B authorized Algorithm B to C denial propagation remains complete and primary-write-free', () => {
  const context = createPr9bContext();
  try {
    mutatePr8CandidateForPostingConflict(context);
    const before = totalChanges(context.db);
    const result = context.postingRepository.post(postingCommand(context));
    assert.deepEqual(
      {
        authoritativeDenialCause: result.authoritativeDenialCause,
        classification: result.classification,
        outcome: result.outcome,
        stage: result.evidence.stage,
      },
      {
        authoritativeDenialCause: 'PR8_EVIDENCE_MISMATCH',
        classification: 'C8',
        outcome: 'DENIAL_PERSISTED',
        stage: 'COMPLETE',
      },
    );
    assert.equal(totalChanges(context.db) - before, 6);
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY);
  } finally {
    context.db.close();
  }
});

for (const stage of STAGES) {
  test(`PR9B authorized seam replay preserves ${stage} read-only`, () => {
    const context = createPostingDenialStageFixture(stage);
    try {
      const repository = createInstrumentedEligibilityRepository(context);
      const graphBefore = postingGraphSnapshot(context.db);
      const before = totalChanges(context.db);
      const result = repository.orchestratePostingDenial(context.seamCommand);
      assert.deepEqual(
        { classification: result.classification, outcome: result.outcome },
        expectedSeam(stage),
      );
      assert.equal(result.evidence.stage, stage);
      assert.equal(totalChanges(context.db) - before, 0);
      assert.equal(postingGraphSnapshot(context.db), graphBefore);
    } finally {
      context.db.close();
    }
  });
}

test('PR9B exact committed replay performs no SELECT or PRAGMA after COMMIT', () => {
  const context = createPr9bContext();
  try {
    const command = postingCommand(context);
    const created = context.postingRepository.post(command);
    const graphBefore = postingGraphSnapshot(context.db);
    const before = totalChanges(context.db);
    const replay = invokeWithPostCommitProof(
      context.db,
      () => context.postingRepository.post(command),
    );
    assert.equal(replay.outcome, 'EXACT_COMMITTED_RESULT');
    assert.deepEqual(replay.evidence, created.evidence);
    assert.equal(totalChanges(context.db) - before, 0);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
  } finally {
    context.db.close();
  }
});

for (const stage of STAGES) {
  test(`PR9B ${stage} denial replay performs no SELECT or PRAGMA after COMMIT`, () => {
    const context = createPostingDenialStageFixture(stage);
    try {
      const repository = createInstrumentedEligibilityRepository(context);
      const graphBefore = postingGraphSnapshot(context.db);
      const before = totalChanges(context.db);
      const replay = invokeWithPostCommitProof(
        context.db,
        () => repository.orchestratePostingDenial(context.seamCommand),
      );
      assert.deepEqual(
        { classification: replay.classification, outcome: replay.outcome },
        expectedSeam(stage),
      );
      assert.equal(totalChanges(context.db) - before, 0);
      assert.equal(postingGraphSnapshot(context.db), graphBefore);
    } finally {
      context.db.close();
    }
  });
}

test('PR9B corrupted durable replay performs no SELECT or PRAGMA after COMMIT', () => {
  const context = createPr9bContext();
  try {
    const command = postingCommand(context);
    context.postingRepository.post(command);
    mutateProtectedRow(
      context.db,
      'canonical_receivable_posting_operations',
      "resultHash = '0000000000000000000000000000000000000000000000000000000000000000'",
    );
    const graphBefore = postingGraphSnapshot(context.db);
    const before = totalChanges(context.db);
    const replay = invokeWithPostCommitProof(
      context.db,
      () => context.postingRepository.post(command),
    );
    assert.equal(replay.outcome, 'PRIMARY_RESULT_INTEGRITY_BLOCKED');
    assert.equal(totalChanges(context.db) - before, 0);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
  } finally {
    context.db.close();
  }
});

test('PR9B replay qualifier is immutable at lock release despite an immediate authority mutation', () => {
  const context = createPr9bContext();
  try {
    const command = postingCommand(context);
    context.postingRepository.post(command);
    const replay = invokeWithPostCommitProof(
      context.db,
      () => context.postingRepository.post(command),
      () => mutateProtectedRow(
        context.db,
        'governed_adapter_authority_records',
        "artifactDigest = 'post-release-corruption' WHERE authorityKind = 'canonical_posting_adapter'",
      ),
    );
    assert.equal(replay.outcome, 'EXACT_COMMITTED_RESULT');
    assert.equal(replay.currentAdmissionStatus, 'CURRENTLY_ADMITTED');
    assert.equal(replay.currentDenialCause, null);
  } finally {
    context.db.close();
  }
});

function traceAttempt(mutate) {
  const context = createPr9bContext();
  const trace = createEvidenceTrace();
  try {
    if (mutate) mutate(context);
    const repository = createPostingRepositoryForTest(context, {
      clock: () => Date.parse(context.event.createdAt),
      evidenceRecorder: trace.record,
      uuid() {
        throw new Error('stop after authoritative reads');
      },
    });
    let result = null;
    let error = null;
    try {
      result = repository.post(postingCommand(context));
    } catch (caught) {
      error = caught;
    }
    return {
      digest: trace.digest(),
      entries: structuredClone(trace.entries),
      error,
      primary: primaryCounts(context.db),
      result,
    };
  } finally {
    context.db.close();
  }
}

test('PR9B recorder captures successful authority reads at the raw DB boundary', () => {
  const attempt = traceAttempt();
  const tables = new Set(attempt.entries.map(entry => entry.table).filter(Boolean));
  assert.equal(tables.has('canonical_write_authorization_records'), true);
  assert.equal(tables.has('canonical_posting_activation_records'), true);
  assert.equal(tables.has('governed_adapter_authority_records'), true);
  assert.equal(attempt.error?.code, 'CANONICAL_POSTING_ID_GENERATION_FAILED');
  assert.deepEqual(attempt.primary, ZERO_PRIMARY);
});

test('PR9B recorder captures a corrupt actual event before event validation fails', () => {
  const context = createPr9bContext();
  const trace = createEvidenceTrace();
  try {
    mutateProtectedRow(
      context.db,
      'actual_receivable_eligible_events',
      "eventHash = '0000000000000000000000000000000000000000000000000000000000000000'",
    );
    const repository = createInstrumentedEligibilityRepository(context, {
      clock: () => Date.parse(context.event.createdAt),
      evidenceRecorder: trace.record,
    });
    assert.throws(
      () => repository.orchestratePostingDenial({
        assertedDenialCause: 'PR8_EVIDENCE_MISMATCH',
        denialAttemptId: '42000000-0000-4000-8000-000000000001',
        postingCommand: postingCommand(context),
      }),
      error => error.code === 'CANONICAL_ENVELOPE_INVALID' && /eventHash mismatch/.test(error.message),
    );
    const eventHash = rawColumn(
      trace.entries,
      'actual_receivable_eligible_events',
      'eventHash',
    );
    assert.equal(eventHash?.storageClass, 'text');
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY);
  } finally {
    context.db.close();
  }
});

test('PR9B raw recorder preserves malformed authorization BLOB error precedence', () => {
  const mutation = context => mutateProtectedRow(
    context.db,
    'canonical_write_authorization_records',
    'acceptedPr8EvidenceHash = ?',
    [Buffer.from([0])],
  );
  const recorded = traceAttempt(mutation);
  const controlContext = createPr9bContext();
  let controlError;
  try {
    mutation(controlContext);
    const repository = createPostingRepositoryForTest(controlContext, {
      clock: () => Date.parse(controlContext.event.createdAt),
      uuid() {
        throw new Error('stop after authoritative reads');
      },
    });
    try {
      repository.post(postingCommand(controlContext));
    } catch (error) {
      controlError = error;
    }
  } finally {
    controlContext.db.close();
  }
  assert.equal(recorded.error?.code, controlError?.code);
  assert.equal(recorded.error?.message, controlError?.message);
  assert.equal(rawColumn(
    recorded.entries,
    'canonical_write_authorization_records',
    'acceptedPr8EvidenceHash',
  )?.storageClass, 'blob');
  assert.deepEqual(recorded.primary, ZERO_PRIMARY);
});

test('PR9B raw recorder covers SQLite storage classes and malformed JSON deterministically', () => {
  const baselineA = traceAttempt();
  const blob = traceAttempt(context => mutateProtectedRow(
    context.db,
    'canonical_write_authorization_records',
    'acceptedPr8EvidenceHash = ?',
    [Buffer.from([0, 255, 1])],
  ));
  const real = traceAttempt(context => mutateProtectedRow(
    context.db,
    'canonical_write_authorization_records',
    'authorizationVersion = 1.5',
  ));
  const malformedJson = traceAttempt(context => mutateProtectedRow(
    context.db,
    'canonical_write_authorization_records',
    "acceptedPr8EvidenceJson = '{'",
  ));
  const baselineHashA = rawColumn(
    baselineA.entries,
    'canonical_write_authorization_records',
    'acceptedPr8EvidenceHash',
  );
  const repeatedBaselineHashes = baselineA.entries.flatMap(entry => (
    entry.phase === 'sqlite_raw_read' && entry.table === 'canonical_write_authorization_records'
      ? entry.rows.flatMap(row => row.columns
        .filter(column => column.column === 'acceptedPr8EvidenceHash')
        .map(column => column.rawDigest))
      : []
  ));
  assert.equal(baselineHashA.storageClass, 'text');
  assert.equal(rawColumn(
    baselineA.entries,
    'canonical_write_authorization_records',
    'authorizationVersion',
  ).storageClass, 'integer');
  assert.equal(rawColumn(
    baselineA.entries,
    'canonical_write_authorization_records',
    'previousRecordId',
  ).storageClass, 'null');
  assert.equal(rawColumn(
    blob.entries,
    'canonical_write_authorization_records',
    'acceptedPr8EvidenceHash',
  ).storageClass, 'blob');
  assert.equal(rawColumn(
    real.entries,
    'canonical_write_authorization_records',
    'authorizationVersion',
  ).storageClass, 'real');
  assert.equal(rawColumn(
    malformedJson.entries,
    'canonical_write_authorization_records',
    'acceptedPr8EvidenceJson',
  ).storageClass, 'text');
  assert.equal(repeatedBaselineHashes.length > 1, true);
  assert.equal(new Set(repeatedBaselineHashes).size, 1);
  assert.notEqual(baselineHashA.rawDigest, blob.entries.length === 0 ? null : rawColumn(
    blob.entries,
    'canonical_write_authorization_records',
    'acceptedPr8EvidenceHash',
  ).rawDigest);
  assert.notEqual(baselineA.digest, blob.digest);
  assert.deepEqual(blob.primary, ZERO_PRIMARY);
  assert.deepEqual(real.primary, ZERO_PRIMARY);
  assert.deepEqual(malformedJson.primary, ZERO_PRIMARY);
});

test('PR9B recorder adds no SQLite reads and callback failure remains observational', () => {
  const context = createPr9bContext();
  function invoke(evidenceRecorder) {
    const counter = instrumentSqliteReadCount(context.db);
    try {
      const repository = createPostingRepositoryForTest(context, {
        clock: () => Date.parse(context.event.createdAt),
        evidenceRecorder,
      });
      const result = repository.post(postingCommand(context, context.event, {
        assertedSelectedDueDatePolicyHash: '0000000000000000000000000000000000000000000000000000000000000000',
      }));
      return {
        graph: postingGraphSnapshot(context.db),
        reads: counter.count(),
        result,
      };
    } finally {
      counter.restore();
    }
  }
  try {
    const control = invoke(undefined);
    const recorded = invoke(() => {});
    const throwing = invoke(() => {
      throw new Error('recorder unavailable');
    });
    assert.equal(JSON.stringify(recorded.result), JSON.stringify(control.result));
    assert.equal(JSON.stringify(throwing.result), JSON.stringify(control.result));
    assert.equal(recorded.graph, control.graph);
    assert.equal(throwing.graph, control.graph);
    assert.equal(recorded.reads, control.reads);
    assert.equal(throwing.reads, control.reads);
  } finally {
    context.db.close();
  }
});

for (const hostile of [
  {
    expectedTable: 'governed_adapter_authority_records',
    mutate(context) {
      mutateProtectedRow(
        context.db,
        'governed_adapter_authority_records',
        "artifactDigest = 'authority-hash-corruption' WHERE authorityKind = 'source_adapter'",
      );
    },
    name: 'authority hash corruption',
  },
  {
    expectedTable: 'governed_adapter_authority_records',
    mutate(context) {
      const descendant = appendAuthorityDescendant(context, context.authority.source);
      const corrupted = { ...descendant, previousRecordId: null };
      corrupted.recordHash = computeGovernedAuthorityRecordHash(corrupted);
      mutateProtectedRow(
        context.db,
        'governed_adapter_authority_records',
        'previousRecordId = ?, recordHash = ? WHERE recordId = ?',
        [corrupted.previousRecordId, corrupted.recordHash, corrupted.recordId],
      );
    },
    name: 'frozen chain corruption',
  },
  {
    expectedTable: 'canonical_write_authorization_records',
    mutate(context) {
      mutateProtectedRow(
        context.db,
        'canonical_write_authorization_records',
        "acceptedPr8EvidenceHash = '0000000000000000000000000000000000000000000000000000000000000000'",
      );
    },
    name: 'authorization evidence corruption',
  },
  {
    expectedTable: 'canonical_posting_activation_records',
    mutate(context) {
      mutateProtectedRow(
        context.db,
        'canonical_posting_activation_records',
        "approvalHash = '0000000000000000000000000000000000000000000000000000000000000000'",
      );
    },
    name: 'activation corruption',
  },
  {
    expectedTable: 'actual_source_dry_run_checks',
    mutate(context) {
      mutateProtectedRow(
        context.db,
        'actual_source_dry_run_checks',
        "checkHash = '0000000000000000000000000000000000000000000000000000000000000000' WHERE id = (SELECT id FROM actual_source_dry_run_checks ORDER BY id LIMIT 1)",
      );
    },
    name: 'PR8 corruption',
  },
]) {
  test(`PR9B recorder retains the actual ${hostile.name} read before validation failure`, () => {
    const attempt = traceAttempt(hostile.mutate);
    assert.equal(
      attempt.entries.some(entry => entry.table === hostile.expectedTable),
      true,
    );
    assert.notEqual(attempt.result?.outcome, 'POSTED');
    assert.deepEqual(attempt.primary, ZERO_PRIMARY);
  });
}

test('PR9B recorder digest changes on corruption and omits authority tables never read', () => {
  const admitted = traceAttempt();
  const corrupted = traceAttempt(context => mutateProtectedRow(
    context.db,
    'canonical_write_authorization_records',
    "acceptedPr8EvidenceHash = '0000000000000000000000000000000000000000000000000000000000000000'",
  ));
  const tables = new Set(corrupted.entries.map(entry => entry.table).filter(Boolean));
  assert.notEqual(corrupted.digest, admitted.digest);
  assert.equal(tables.has('canonical_write_authorization_records'), true);
  assert.equal(tables.has('canonical_posting_activation_records'), true);
  assert.equal(tables.has('pr9b_table_that_was_never_read'), false);
  assert.equal(rawColumn(
    corrupted.entries,
    'governed_adapter_authority_records',
    'recordId',
  ), null);
});

test('PR9B recorder captures durable classification rows before corrupt replay classification', () => {
  const context = createPr9bContext();
  const trace = createEvidenceTrace();
  try {
    const command = postingCommand(context);
    context.postingRepository.post(command);
    mutateProtectedRow(
      context.db,
      'canonical_receivable_posting_operations',
      "resultHash = '0000000000000000000000000000000000000000000000000000000000000000'",
    );
    const repository = createPostingRepositoryForTest(context, { evidenceRecorder: trace.record });
    const result = repository.post(command);
    assert.equal(result.outcome, 'PRIMARY_RESULT_INTEGRITY_BLOCKED');
    assert.equal(trace.entries.some(entry => (
      entry.phase === 'durable_classification_read'
      && entry.table === 'canonical_receivable_posting_operations'
      && entry.rows.length === 1
    )), true);
  } finally {
    context.db.close();
  }
});
