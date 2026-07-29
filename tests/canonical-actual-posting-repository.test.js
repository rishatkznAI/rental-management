import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendAuthorityDescendant,
  canonicalJson,
  createPr9bContext,
  hash,
  mutatePr8CandidateForPostingConflict,
  normalizedPostingCommandEvidence,
  postingCommand,
  postingGraphSnapshot,
  totalChanges,
} from './canonical-actual-posting-fixtures.js';

const PRIMARY_TABLES = [
  'canonical_receivables',
  'canonical_receivable_posting_operations',
  'financial_audit_events',
];

function primaryCounts(db) {
  return Object.fromEntries(PRIMARY_TABLES.map(table => [
    table,
    Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
  ]));
}

test('PR9B normalizes transport-equivalent commands and rejects assertion mismatch read-only', () => {
  const context = createPr9bContext();
  try {
    const commandA = postingCommand(context);
    const commandB = JSON.stringify(Object.fromEntries(Object.entries(commandA).reverse()), null, 2);
    const normalizedA = normalizedPostingCommandEvidence(commandA);
    const normalizedB = normalizedPostingCommandEvidence(commandB);
    assert.deepEqual(normalizedB.normalized, normalizedA.normalized);
    assert.equal(normalizedB.fingerprint, normalizedA.fingerprint);

    const mismatch = postingCommand(context, context.event, { assertedEventHash: hash('not-the-event') });
    const mismatchEvidence = normalizedPostingCommandEvidence(mismatch);
    assert.notEqual(mismatchEvidence.fingerprint, normalizedA.fingerprint);
    const beforeGraph = postingGraphSnapshot(context.db);
    const beforeChanges = totalChanges(context.db);
    const result = context.postingService.postCanonicalReceivable(mismatch);
    assert.equal(result.outcome, 'CANONICAL_POSTING_ASSERTION_MISMATCH');
    assert.equal(result.classification, 'ASSERTION_MISMATCH');
    assert.equal(result.normalizedFingerprint, mismatchEvidence.fingerprint);
    assert.deepEqual(result.intendedWriteSet, []);
    assert.deepEqual(result.comparisonEvidence, [{
      asserted: mismatch.assertedEventHash,
      authoritative: context.event.eventHash,
      field: 'assertedEventHash',
      matches: false,
    }]);
    assert.equal(totalChanges(context.db) - beforeChanges, 0);
    assert.equal(postingGraphSnapshot(context.db), beforeGraph);

    const valid = context.postingService.postCanonicalReceivable(commandB);
    assert.equal(valid.outcome, 'POSTED');
    assert.equal(valid.evidence.commandFingerprint, normalizedA.fingerprint);
  } finally {
    context.db.close();
  }
});

test('PR9B persists and rereads one atomic mapped primary triplet, then exact-replays read-only', () => {
  const context = createPr9bContext();
  try {
    const command = postingCommand(context);
    const created = context.postingService.postCanonicalReceivable(command);
    assert.equal(created.outcome, 'POSTED');
    assert.equal(created.classification, 'NO_RESULT_ADMITTED');
    assert.deepEqual(created.intendedWriteSet, PRIMARY_TABLES);
    assert.deepEqual(primaryCounts(context.db), {
      canonical_receivables: 1,
      canonical_receivable_posting_operations: 1,
      financial_audit_events: 1,
    });
    const receivable = context.db.prepare('SELECT * FROM canonical_receivables').get();
    const operation = context.db.prepare('SELECT * FROM canonical_receivable_posting_operations').get();
    const audit = context.db.prepare('SELECT * FROM financial_audit_events').get();
    assert.equal(receivable.sourceDocumentType, 'rental_service_upd');
    assert.equal(receivable.sourceDocumentId, context.event.rootSourceDocumentLineageId);
    assert.equal(receivable.sourceLineId, context.event.economicLineageKey);
    assert.equal(receivable.externalId, context.event.economicLineageKey);
    assert.equal(operation.canonicalReceivableId, receivable.id);
    assert.equal(operation.financialAuditEventId, audit.id);
    assert.equal(operation.eventId, context.event.id);
    assert.equal(operation.correlationId, context.event.correlationId);
    assert.equal(audit.correlationId, context.event.correlationId);
    assert.equal(audit.aggregateId, receivable.id);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
    assert.equal(context.db.pragma('integrity_check', { simple: true }), 'ok');

    const beforeGraph = postingGraphSnapshot(context.db);
    const beforeChanges = totalChanges(context.db);
    const replay = context.postingService.postCanonicalReceivable(canonicalJson(command));
    assert.equal(replay.outcome, 'EXACT_COMMITTED_RESULT');
    assert.equal(replay.classification, 'PRIMARY_POSTED_EXACT');
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.intendedWriteSet, []);
    assert.deepEqual(replay.evidence, created.evidence);
    assert.equal(totalChanges(context.db) - beforeChanges, 0);
    assert.equal(postingGraphSnapshot(context.db), beforeGraph);
  } finally {
    context.db.close();
  }
});

test('PR9B durable primary result wins before later current-authority drift', () => {
  const context = createPr9bContext();
  try {
    const command = postingCommand(context);
    const created = context.postingService.postCanonicalReceivable(command);
    appendAuthorityDescendant(context, context.authority.posting, {
      status: 'revoked',
      revocationReasonCode: 'PR9B_TEST_REVOCATION',
    });
    const beforeGraph = postingGraphSnapshot(context.db);
    const beforeChanges = totalChanges(context.db);
    const replay = context.postingService.postCanonicalReceivable(command);
    assert.equal(replay.outcome, 'EXACT_COMMITTED_RESULT');
    assert.equal(replay.historicalPostingOutcome, 'EXACT_COMMITTED_RESULT');
    assert.equal(replay.currentAdmissionStatus, 'CURRENTLY_DENIED');
    assert.equal(replay.currentDenialCause, 'CANONICAL_POSTING_ADAPTER_REVOKED');
    assert.deepEqual(replay.evidence, created.evidence);
    assert.equal(totalChanges(context.db) - beforeChanges, 0);
    assert.equal(postingGraphSnapshot(context.db), beforeGraph);
  } finally {
    context.db.close();
  }
});

test('PR9B rolls back Algorithm B before bounded C denial persistence and never mixes graphs', () => {
  const context = createPr9bContext();
  try {
    mutatePr8CandidateForPostingConflict(context);
    const before = totalChanges(context.db);
    const denial = context.postingService.postCanonicalReceivable(postingCommand(context));
    assert.equal(denial.outcome, 'DENIAL_PERSISTED');
    assert.equal(denial.classification, 'C8');
    assert.equal(denial.authoritativeDenialCause, 'PR8_EVIDENCE_MISMATCH');
    assert.equal(denial.evidence.stage, 'COMPLETE');
    assert.deepEqual(denial.intendedWriteSet, [
      'canonical_receivable_posting_conflicts',
      'canonical_receivable_posting_conflict_transitions',
    ]);
    assert.equal(totalChanges(context.db) - before, 6);
    assert.deepEqual(primaryCounts(context.db), {
      canonical_receivables: 0,
      canonical_receivable_posting_operations: 0,
      financial_audit_events: 0,
    });
    assert.equal(Number(context.db.prepare(
      'SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflicts',
    ).get().count), 1);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);

    const graphBeforeReplay = postingGraphSnapshot(context.db);
    const changesBeforeReplay = totalChanges(context.db);
    const replay = context.postingService.postCanonicalReceivable(postingCommand(context));
    assert.equal(replay.outcome, 'CONFLICT_COMPLETED');
    assert.equal(replay.classification, 'CONFLICT_COMPLETED');
    assert.deepEqual(replay.intendedWriteSet, []);
    assert.equal(totalChanges(context.db) - changesBeforeReplay, 0);
    assert.equal(postingGraphSnapshot(context.db), graphBeforeReplay);
  } finally {
    context.db.close();
  }
});

for (const [name, trigger] of [
  ['canonical insert', `BEFORE INSERT ON canonical_receivables`],
  ['operation insert', `BEFORE INSERT ON canonical_receivable_posting_operations`],
  ['audit insert', `BEFORE INSERT ON financial_audit_events`],
]) {
  test(`PR9B rolls back the whole primary triplet after forced ${name} failure`, () => {
    const context = createPr9bContext();
    try {
      context.db.exec(`CREATE TRIGGER pr9b_primary_abort ${trigger}
        BEGIN SELECT RAISE(ABORT, 'forced PR9B primary rollback'); END`);
      assert.throws(
        () => context.postingService.postCanonicalReceivable(postingCommand(context)),
        error => error.code === 'CANONICAL_POSTING_PERSISTENCE_FAILED',
      );
      assert.deepEqual(primaryCounts(context.db), {
        canonical_receivables: 0,
        canonical_receivable_posting_operations: 0,
        financial_audit_events: 0,
      });
      assert.equal(Number(context.db.prepare(
        'SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflicts',
      ).get().count), 0);
      assert.deepEqual(context.db.pragma('foreign_key_check'), []);
    } finally {
      context.db.close();
    }
  });
}
