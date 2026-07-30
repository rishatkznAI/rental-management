import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInstrumentedEligibilityRepository,
  createEvidenceTrace,
  createPostingDenialStageFixture,
  hash,
  normalizedPostingCommandEvidence,
  postingCommand,
  postingEvidenceReadDigest,
  postingEvidenceReadSet,
  postingGraphSnapshot,
  totalChanges,
} from './canonical-actual-posting-fixtures.js';

const STAGES = ['PENDING', 'ACCOUNTED', 'CIRCUIT_APPLIED', 'COMPLETE'];
const READ_ONLY_WRITE_SET = Object.freeze([]);

function pairEvidence(repository, transitionId) {
  const pair = repository.readConflictPair(transitionId);
  return {
    conflictHash: pair.conflict.conflictHash,
    conflictId: pair.conflict.id,
    conflictType: pair.conflict.conflictType,
    denialAttemptId: pair.conflict.denialAttemptId,
    deniedAttemptedAt: pair.conflict.deniedAttemptedAt,
    evidenceAttemptedAt: pair.conflict.evidenceAttemptedAt,
    stage: pair.transition.state,
    transitionHash: pair.transition.intentHash,
    transitionId: pair.transition.transitionId,
  };
}

function expectedSeam(stage) {
  return stage === 'COMPLETE'
    ? { classification: 'C5', outcome: 'EXACT_CONFLICT_REPLAY' }
    : { classification: 'C7', outcome: 'CONFLICT_RECOVERY_REQUIRED' };
}

function invokeReadOnly(context, {
  command,
  entrypoint,
  packageValue,
  repository,
  seamCommand,
  trace,
}) {
  trace.reset();
  const graphBefore = postingGraphSnapshot(context.db);
  const changesBefore = totalChanges(context.db);
  let result;
  if (entrypoint === 'wrapper') {
    const raw = repository.persistDenialEvidence(packageValue);
    assert.equal(raw.replayed, true);
    result = {
      classification: 'EXACT_STAGE_PRESERVING_REPLAY',
      evidence: pairEvidence(repository, raw.conflict.transitionId),
      intendedWriteSet: READ_ONLY_WRITE_SET,
      outcome: 'EXACT_STAGE_PRESERVING_REPLAY',
    };
  } else {
    result = repository.orchestratePostingDenial(seamCommand);
  }
  assert.deepEqual(result.intendedWriteSet, []);
  assert.equal(totalChanges(context.db) - changesBefore, 0);
  assert.equal(postingGraphSnapshot(context.db), graphBefore);
  const readSet = postingEvidenceReadSet(trace);
  return {
    digest: postingEvidenceReadDigest(trace),
    readSet,
    result,
  };
}

function transportForms(context) {
  const commandA = postingCommand(context);
  const commandB = JSON.stringify(Object.fromEntries(Object.entries(commandA).reverse()), null, 2);
  const normalizedA = normalizedPostingCommandEvidence(commandA);
  const normalizedB = normalizedPostingCommandEvidence(commandB);
  assert.deepEqual(normalizedB.normalized, normalizedA.normalized);
  assert.equal(normalizedB.fingerprint, normalizedA.fingerprint);
  return { commandA, commandB, normalizedA, normalizedB };
}

function packagesForTransports(context, repository, commandA, commandB) {
  const conflict = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
  const base = {
    assertedDenialCause: conflict.conflictType,
    denialAttemptId: conflict.denialAttemptId,
  };
  const seamA = { ...base, postingCommand: commandA };
  const seamB = { ...base, postingCommand: commandB };
  const packageA = repository.__testBuildPostingDenialPackage({
    deniedAttemptedAt: conflict.deniedAttemptedAt,
    seamCommand: seamA,
  });
  const packageB = repository.__testBuildPostingDenialPackage({
    deniedAttemptedAt: conflict.deniedAttemptedAt,
    seamCommand: seamB,
  });
  return { packageA, packageB, seamA, seamB };
}

for (const stage of STAGES) {
  for (const sequence of [
    ['wrapper-A', 'seam-B', 'wrapper-B', 'seam-A'],
    ['wrapper-B', 'seam-A', 'wrapper-A', 'seam-B'],
    ['seam-A', 'wrapper-B', 'seam-B', 'wrapper-A'],
    ['seam-B', 'wrapper-A', 'seam-A', 'wrapper-B'],
  ]) {
    test(`PR9B ${stage} preserves cross-entrypoint state for ${sequence.join(' -> ')}`, () => {
      const context = createPostingDenialStageFixture(stage);
      try {
        const trace = createEvidenceTrace();
        const repository = createInstrumentedEligibilityRepository(context, {
          evidenceRecorder: trace.record,
        });
        const { commandA, commandB } = transportForms(context);
        const transports = packagesForTransports(context, repository, commandA, commandB);
        const originalGraph = postingGraphSnapshot(context.db);
        const calls = sequence.map(step => {
          const [entrypoint, transport] = step.split('-');
          const suffix = transport === 'A' ? 'A' : 'B';
          return invokeReadOnly(context, {
            command: suffix === 'A' ? commandA : commandB,
            entrypoint,
            packageValue: transports[`package${suffix}`],
            repository,
            seamCommand: transports[`seam${suffix}`],
            trace,
          });
        });
        const wrapperCalls = calls.filter((_, index) => sequence[index].startsWith('wrapper'));
        const seamCalls = calls.filter((_, index) => sequence[index].startsWith('seam'));
        assert.equal(wrapperCalls.length, 2);
        assert.equal(seamCalls.length, 2);
        assert.deepEqual(wrapperCalls[1], wrapperCalls[0]);
        assert.deepEqual(seamCalls[1], seamCalls[0]);
        assert.equal(wrapperCalls[0].result.evidence.stage, stage);
        assert.deepEqual(
          {
            classification: seamCalls[0].result.classification,
            outcome: seamCalls[0].result.outcome,
          },
          expectedSeam(stage),
        );
        assert.equal(seamCalls[0].result.evidence.stage, stage);
        assert.deepEqual(seamCalls[0].result.evidence, wrapperCalls[0].result.evidence);
        assert.equal(postingGraphSnapshot(context.db), originalGraph);
      } finally {
        context.db.close();
      }
    });
  }
}

for (const stage of STAGES) {
  test(`PR9B ${stage} normalization remains cold, wrapper-warm, and seam-warm`, () => {
    const context = createPostingDenialStageFixture(stage);
    try {
      const { commandA, commandB } = transportForms(context);
      const coldTrace = createEvidenceTrace();
      const coldRepository = createInstrumentedEligibilityRepository(context, {
        evidenceRecorder: coldTrace.record,
      });
      const coldTransports = packagesForTransports(context, coldRepository, commandA, commandB);
      const cold = invokeReadOnly(context, {
        command: commandA,
        entrypoint: 'seam',
        repository: coldRepository,
        seamCommand: coldTransports.seamA,
        trace: coldTrace,
      });

      const wrapperWarmTrace = createEvidenceTrace();
      const wrapperWarmRepository = createInstrumentedEligibilityRepository(context, {
        evidenceRecorder: wrapperWarmTrace.record,
      });
      const wrapperWarmTransports = packagesForTransports(
        context,
        wrapperWarmRepository,
        commandA,
        commandB,
      );
      invokeReadOnly(context, {
        command: commandA,
        entrypoint: 'wrapper',
        packageValue: wrapperWarmTransports.packageA,
        repository: wrapperWarmRepository,
        trace: wrapperWarmTrace,
      });
      const wrapperWarm = invokeReadOnly(context, {
        command: commandB,
        entrypoint: 'seam',
        repository: wrapperWarmRepository,
        seamCommand: wrapperWarmTransports.seamB,
        trace: wrapperWarmTrace,
      });

      const seamWarmTrace = createEvidenceTrace();
      const seamWarmRepository = createInstrumentedEligibilityRepository(context, {
        evidenceRecorder: seamWarmTrace.record,
      });
      const seamWarmTransports = packagesForTransports(context, seamWarmRepository, commandA, commandB);
      invokeReadOnly(context, {
        command: commandB,
        entrypoint: 'seam',
        repository: seamWarmRepository,
        seamCommand: seamWarmTransports.seamB,
        trace: seamWarmTrace,
      });
      const seamWarm = invokeReadOnly(context, {
        command: commandA,
        entrypoint: 'seam',
        repository: seamWarmRepository,
        seamCommand: seamWarmTransports.seamA,
        trace: seamWarmTrace,
      });
      assert.deepEqual(wrapperWarm, cold);
      assert.deepEqual(seamWarm, cold);
    } finally {
      context.db.close();
    }
  });
}

for (const stage of STAGES) {
  for (const order of ['wrapper-first', 'seam-first']) {
    test(`PR9B ${stage} ${order} mismatches are read-only and do not leak`, () => {
      const context = createPostingDenialStageFixture(stage);
      try {
        const trace = createEvidenceTrace();
        const repository = createInstrumentedEligibilityRepository(context, {
          evidenceRecorder: trace.record,
        });
        const validCommand = postingCommand(context);
        const validFingerprint = normalizedPostingCommandEvidence(validCommand).fingerprint;
        const mismatchCommand = postingCommand(context, context.event, {
          assertedEventHash: hash(`PR9B-${stage}-${order}-mismatch`),
        });
        const mismatchFingerprint = normalizedPostingCommandEvidence(mismatchCommand).fingerprint;
        assert.notEqual(mismatchFingerprint, validFingerprint);
        const conflict = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
        const hostilePackage = repository.__testBuildPostingDenialPackage({
          deniedAttemptedAt: new Date(Date.parse(conflict.deniedAttemptedAt) + 1).toISOString(),
          seamCommand: context.seamCommand,
        });
        const mismatchSeam = {
          ...context.seamCommand,
          postingCommand: mismatchCommand,
        };
        const graphBefore = postingGraphSnapshot(context.db);
        const hostileWrapper = () => {
          const before = totalChanges(context.db);
          assert.throws(
            () => repository.persistDenialEvidence(hostilePackage),
            error => error.code === 'CANONICAL_DENIAL_ATTEMPT_ID_COLLISION',
          );
          assert.equal(totalChanges(context.db) - before, 0);
          assert.equal(postingGraphSnapshot(context.db), graphBefore);
        };
        const mismatchedSeam = () => {
          const before = totalChanges(context.db);
          trace.reset();
          const result = repository.orchestratePostingDenial(mismatchSeam);
          assert.equal(result.outcome, 'CANONICAL_POSTING_ASSERTION_MISMATCH');
          assert.equal(result.classification, 'ASSERTION_MISMATCH');
          assert.equal(result.normalizedFingerprint, mismatchFingerprint);
          assert.deepEqual(result.intendedWriteSet, []);
          assert.deepEqual(result.comparisonEvidence, [{
            asserted: mismatchCommand.assertedEventHash,
            authoritative: context.event.eventHash,
            field: 'assertedEventHash',
            matches: false,
          }]);
          assert.equal(totalChanges(context.db) - before, 0);
          assert.equal(postingGraphSnapshot(context.db), graphBefore);
          assert.equal(trace.entries.some(entry => (
            entry.phase === 'posting_assertion_comparison'
            && entry.mismatches?.some(mismatch => mismatch.field === 'assertedEventHash')
          )), true);
        };
        if (order === 'wrapper-first') {
          hostileWrapper();
          mismatchedSeam();
        } else {
          mismatchedSeam();
          hostileWrapper();
        }
        const validSeam = repository.orchestratePostingDenial(context.seamCommand);
        assert.deepEqual(
          { classification: validSeam.classification, outcome: validSeam.outcome },
          expectedSeam(stage),
        );
        const validWrapper = repository.persistDenialEvidence(context.packageValue);
        assert.equal(validWrapper.replayed, true);
        assert.equal(postingGraphSnapshot(context.db), graphBefore);
      } finally {
        context.db.close();
      }
    });
  }
}
