import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendAuthorityDescendant,
  canonicalJson,
  createAdditionalPr8Run,
  createPr9bContext,
  createEvidenceTrace,
  createInstrumentedEligibilityRepository,
  createPostingRepositoryForTest,
  deleteProtectedRows,
  hash,
  insertProtectedRow,
  mutateProtectedRow,
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

function injectAfterAuditReread(db, inject) {
  let injected = false;
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return sql => {
          const statement = target.prepare(sql);
          if (!/^\s*SELECT \* FROM financial_audit_events WHERE id = \?/i.test(String(sql))) {
            return statement;
          }
          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              const value = Reflect.get(statementTarget, statementProperty, statementTarget);
              if (statementProperty === 'get') {
                return (...args) => {
                  const row = value.apply(statementTarget, args);
                  if (row && !injected) {
                    injected = true;
                    inject(row);
                  }
                  return row;
                };
              }
              return typeof value === 'function' ? value.bind(statementTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function mutateProtectedCheckGraph(db, mutation) {
  const triggers = db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = 'actual_source_dry_run_checks' AND sql IS NOT NULL
    ORDER BY name
  `).all();
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
  try {
    mutation();
  } finally {
    for (const trigger of triggers) db.exec(trigger.sql);
  }
}

function changeCheckId(db, replacement, selector = '') {
  const row = db.prepare(`
    SELECT id FROM actual_source_dry_run_checks
    ${selector}
    ORDER BY id LIMIT 1
  `).get();
  mutateProtectedCheckGraph(db, () => {
    db.prepare('UPDATE actual_source_dry_run_checks SET id = ? WHERE id = ?')
      .run(replacement, row.id);
  });
}

const PR8_CHILD_ID_HOSTILES = [
  {
    mutate(context) {
      changeCheckId(context.db, 'hostile-mutated-check-id');
    },
    name: 'one changed child ID',
  },
  {
    mutate(context) {
      const [left, right] = context.db.prepare(`
        SELECT id FROM actual_source_dry_run_checks ORDER BY id LIMIT 2
      `).all();
      const temporary = 'actual-source-check-00000000-0000-4000-8000-000000000000';
      mutateProtectedCheckGraph(context.db, () => {
        context.db.prepare('UPDATE actual_source_dry_run_checks SET id = ? WHERE id = ?')
          .run(temporary, left.id);
        context.db.prepare('UPDATE actual_source_dry_run_checks SET id = ? WHERE id = ?')
          .run(left.id, right.id);
        context.db.prepare('UPDATE actual_source_dry_run_checks SET id = ? WHERE id = ?')
          .run(right.id, temporary);
      });
    },
    name: 'IDs exchanged between two children',
  },
  {
    mutate(context) {
      changeCheckId(context.db, context.authority.candidate.id);
    },
    name: 'child ID duplicated across the PR8 child graph',
  },
  {
    mutate(context) {
      changeCheckId(
        context.db,
        'actual-source-check-22222222-2222-4222-8222-222222222222',
      );
    },
    name: 'well-formed new unique child ID',
  },
  {
    mutate(context) {
      const foreign = createPr9bContext();
      let foreignId;
      try {
        foreignId = foreign.db.prepare(`
          SELECT id FROM actual_source_dry_run_checks ORDER BY id LIMIT 1
        `).get().id;
      } finally {
        foreign.db.close();
      }
      changeCheckId(context.db, foreignId);
    },
    name: 'child ID belonging to another fresh fixture',
  },
  {
    mutate(context) {
      changeCheckId(
        context.db,
        'actual-source-check-33333333-3333-4333-8333-333333333333',
        'WHERE candidateId IS NOT NULL',
      );
    },
    name: 'FK-consistent candidate child ID mutation',
  },
  {
    mutate(context) {
      const additional = createAdditionalPr8Run(context, 'cross-binding');
      const original = context.db.prepare(`
        SELECT * FROM actual_source_dry_run_checks
        WHERE runId = ? AND candidateId IS NOT NULL
        ORDER BY gateCode LIMIT 1
      `).get(context.authority.run.id);
      const replacement = context.db.prepare(`
        SELECT * FROM actual_source_dry_run_checks
        WHERE runId = ? AND gateCode = ? AND candidateId IS NOT NULL
      `).get(additional.dryRunId, original.gateCode);
      mutateProtectedCheckGraph(context.db, () => {
        context.db.prepare(`
          UPDATE actual_source_dry_run_checks SET gateCode = ? WHERE id = ?
        `).run(`temporary_${replacement.gateCode}`, replacement.id);
        context.db.prepare(`
          UPDATE actual_source_dry_run_checks SET runId = ?, candidateId = ? WHERE id = ?
        `).run(replacement.runId, replacement.candidateId, original.id);
        context.db.prepare(`
          UPDATE actual_source_dry_run_checks
          SET runId = ?, candidateId = ?, gateCode = ? WHERE id = ?
        `).run(original.runId, original.candidateId, original.gateCode, replacement.id);
      });
    },
    name: 'fresh-run parent and child cross-binding',
  },
];

for (const hostile of PR8_CHILD_ID_HOSTILES) {
  test(`PR9B PR8 child identity seal rejects ${hostile.name}`, () => {
    const context = createPr9bContext();
    try {
      hostile.mutate(context);
      assert.deepEqual(context.db.pragma('foreign_key_check'), []);
      const before = totalChanges(context.db);
      const result = context.postingRepository.post(postingCommand(context));
      assert.deepEqual(
        {
          authoritativeDenialCause: result.authoritativeDenialCause,
          classification: result.classification,
          outcome: result.outcome,
          stage: result.evidence?.stage,
        },
        {
          authoritativeDenialCause: 'PR8_EVIDENCE_MISMATCH',
          classification: 'C8',
          outcome: 'DENIAL_PERSISTED',
          stage: 'COMPLETE',
        },
      );
      assert.equal(totalChanges(context.db) - before, 6);
      assert.deepEqual(primaryCounts(context.db), {
        canonical_receivables: 0,
        canonical_receivable_posting_operations: 0,
        financial_audit_events: 0,
      });
      assert.equal(Number(context.db.prepare(
        'SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflicts',
      ).get().count), 1);
      assert.equal(Number(context.db.prepare(
        'SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflict_transitions WHERE state = \'COMPLETE\'',
      ).get().count), 1);
      assert.deepEqual(context.db.pragma('foreign_key_check'), []);
    } finally {
      context.db.close();
    }
  });
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

const ZERO_PRIMARY_COUNTS = Object.freeze({
  canonical_receivables: 0,
  canonical_receivable_posting_operations: 0,
  financial_audit_events: 0,
});

function uuidSequence(values) {
  let index = 0;
  return () => values[index++];
}

function callPosting(repository, command) {
  try {
    return { result: repository.post(command) };
  } catch (error) {
    return { error };
  }
}

for (const hostile of [
  {
    name: 'unsafe INTEGER above Number.MAX_SAFE_INTEGER',
    setClause: 'allocatedGrossMinor = 9007199254740992 WHERE id = ?',
  },
  {
    name: 'wrong SQLite storage class',
    setClause: "schemaVersion = X'31' WHERE id = ?",
  },
  {
    name: 'invalid integer range',
    setClause: 'schemaVersion = 0 WHERE id = ?',
  },
  {
    name: 'malformed persisted PR6 field',
    setClause: 'allocatedGrossMinor = 1.5 WHERE id = ?',
  },
]) {
  test(`P1-01 Algorithm B rejects ${hostile.name} before clock, generators, and DML`, () => {
    const context = createPr9bContext();
    try {
      mutateProtectedRow(
        context.db,
        'billing_source_coverage_slices',
        hostile.setClause,
        [context.authority.candidate.coverageSliceId],
      );
      let clockCalls = 0;
      let uuidCalls = 0;
      const repository = createPostingRepositoryForTest(context, {
        clock() {
          clockCalls += 1;
          return Date.now();
        },
        uuid() {
          uuidCalls += 1;
          return '10000000-0000-4000-8000-000000000001';
        },
      });
      const graphBefore = postingGraphSnapshot(context.db);
      assert.throws(
        () => repository.post(postingCommand(context)),
        error => error.code === 'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
      );
      assert.equal(clockCalls, 0);
      assert.equal(uuidCalls, 0);
      assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
      assert.equal(postingGraphSnapshot(context.db), graphBefore);
    } finally {
      context.db.close();
    }
  });
}

test('P1-01 final pre-DML PR6 storage verification catches a locked-snapshot mutation', () => {
  const context = createPr9bContext();
  try {
    let clockCalls = 0;
    let uuidCalls = 0;
    const ids = [
      '10000000-0000-4000-8000-000000000011',
      '10000000-0000-4000-8000-000000000012',
      '10000000-0000-4000-8000-000000000013',
    ];
    const repository = createPostingRepositoryForTest(context, {
      clock() {
        clockCalls += 1;
        return Date.now();
      },
      uuid() {
        uuidCalls += 1;
        if (uuidCalls === ids.length) {
          mutateProtectedRow(
            context.db,
            'billing_source_coverage_slices',
            'schemaVersion = 0 WHERE id = ?',
            [context.authority.candidate.coverageSliceId],
          );
        }
        return ids[uuidCalls - 1];
      },
    });
    const graphBefore = postingGraphSnapshot(context.db);
    assert.throws(
      () => repository.post(postingCommand(context)),
      error => error.code === 'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
    );
    assert.equal(clockCalls, 1);
    assert.equal(uuidCalls, 3);
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
    assert.equal(
      context.db.prepare('SELECT schemaVersion FROM billing_source_coverage_slices WHERE id = ?')
        .get(context.authority.candidate.coverageSliceId).schemaVersion,
      1,
    );
  } finally {
    context.db.close();
  }
});

const AUTHORITATIVE_TAMPERING_CASES = [
  ['event root hash', 'actual_receivable_eligible_events', "eventHash = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['PR8 run result', 'actual_source_dry_runs', "resultHash = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['PR8 candidate result', 'actual_source_dry_run_candidates', "resultHash = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['PR8 input normalized projection', 'actual_source_dry_run_inputs', "normalizedInputHash = '0000000000000000000000000000000000000000000000000000000000000000' WHERE id = (SELECT id FROM actual_source_dry_run_inputs ORDER BY id LIMIT 1)"],
  ['PR8 check seal (audit reproduction)', 'actual_source_dry_run_checks', "checkHash = '0000000000000000000000000000000000000000000000000000000000000000' WHERE id = (SELECT id FROM actual_source_dry_run_checks ORDER BY id LIMIT 1)"],
  ['PR8 reconciliation seal', 'actual_source_dry_run_reconciliations', "reconciliationHash = '0000000000000000000000000000000000000000000000000000000000000000' WHERE id = (SELECT id FROM actual_source_dry_run_reconciliations ORDER BY id LIMIT 1)"],
  ['PR8 operation seal', 'actual_source_dry_run_operations', "resultHash = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['PR8 audit seal', 'actual_source_dry_run_audit_events', "resultHash = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['write authorization evidence binding', 'canonical_write_authorization_records', "acceptedPr8EvidenceHash = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['activation evidence binding', 'canonical_posting_activation_records', "acceptedDryRunsHash = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['authority record seal', 'governed_adapter_authority_records', "artifactDigest = 'tampered-artifact' WHERE authorityKind = 'source_adapter'"],
  ['PR6 physical-source binding', 'billing_source_coverage_slices', "sliceHash = '0000000000000000000000000000000000000000000000000000000000000000'"],
];

for (const [name, table, setClause] of AUTHORITATIVE_TAMPERING_CASES) {
  test(`P1-02 full locked graph rejects one-field tampering: ${name}`, () => {
    const context = createPr9bContext();
    try {
      mutateProtectedRow(context.db, table, setClause);
      const trace = createEvidenceTrace();
      const repository = createPostingRepositoryForTest(context, {
        evidenceRecorder: trace.record,
      });
      const invocation = callPosting(repository, postingCommand(context));
      assert.notEqual(invocation.result?.outcome, 'POSTED');
      assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
      assert.equal(trace.entries.length > 0, true);
      if (name.includes('audit reproduction')) {
        assert.equal(
          trace.entries.some(entry => (
            entry.table === 'actual_source_dry_run_checks'
            && entry.rows?.some(row => row.checkHash === '0'.repeat(64))
          )),
          true,
        );
      }
    } finally {
      context.db.close();
    }
  });
}

test('P1-02 full PR8 graph rejects a hostile diagnostic child row', () => {
  const context = createPr9bContext();
  try {
    const run = context.db.prepare('SELECT * FROM actual_source_dry_runs').get();
    insertProtectedRow(context.db, 'actual_source_dry_run_diagnostics', {
      id: 'hostile-diagnostic',
      runId: run.id,
      candidateId: context.event.candidateId,
      companyId: run.companyId,
      branchId: run.branchId,
      severity: 'info',
      code: 'HOSTILE_DIAGNOSTIC',
      sourceKind: null,
      sourceId: null,
      sourceVersion: null,
      affectedStartDate: null,
      affectedEndDateExclusive: null,
      expectedEvidenceJson: '{}',
      observedEvidenceJson: '{}',
      policyReferencesJson: '[]',
      detectedAt: run.createdAt,
      detectorVersion: 'hostile-fixture-v1',
      diagnosticHash: '0'.repeat(64),
      schemaVersion: 1,
    });
    const invocation = callPosting(context.postingRepository, postingCommand(context));
    assert.notEqual(invocation.result?.outcome, 'POSTED');
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
  } finally {
    context.db.close();
  }
});

const PRIMARY_TRIPLET_MUTATIONS = [
  ['operation resultHash audit reproduction', 'canonical_receivable_posting_operations', "resultHash = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['canonical fingerprint', 'canonical_receivable_posting_operations', "canonicalReceivableFingerprint = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['command fingerprint', 'canonical_receivable_posting_operations', "commandFingerprint = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['audit payload fingerprint', 'canonical_receivable_posting_operations', "auditPayloadFingerprint = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['audit event fingerprint', 'canonical_receivable_posting_operations', "auditEventFingerprint = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['operation event binding', 'canonical_receivable_posting_operations', "eventHash = '0000000000000000000000000000000000000000000000000000000000000000'"],
  ['canonical payload amount', 'canonical_receivables', 'originalAmountMinor = originalAmountMinor + 1'],
  ['canonical physical-source binding', 'canonical_receivables', "sourceLineId = 'tampered-source-line'"],
  ['canonical idempotency binding', 'canonical_receivables', "idempotencyKey = 'tampered-idempotency'"],
  ['audit payload bytes', 'financial_audit_events', "newValueJson = '{}'"],
  ['audit aggregate binding', 'financial_audit_events', "aggregateId = 'tampered-aggregate'"],
  ['audit correlation binding', 'financial_audit_events', "correlationId = 'tampered-correlation'"],
  ['operation ID', 'canonical_receivable_posting_operations', "id = '20000000-0000-4000-8000-000000000001'"],
];

for (const [name, table, setClause] of PRIMARY_TRIPLET_MUTATIONS) {
  test(`P1-03 C1 classifies a complete-looking corrupt triplet as C2: ${name}`, () => {
    const context = createPr9bContext();
    try {
      context.postingRepository.post(postingCommand(context));
      mutateProtectedRow(context.db, table, setClause);
      const graphBefore = postingGraphSnapshot(context.db);
      const changesBefore = totalChanges(context.db);
      const result = context.eligibilityRepository.orchestratePostingDenial({
        assertedDenialCause: 'PR8_EVIDENCE_MISMATCH',
        denialAttemptId: '20000000-0000-4000-8000-000000000099',
        postingCommand: postingCommand(context),
      });
      assert.equal(result.classification, 'C2');
      assert.equal(result.outcome, 'PRIMARY_RESULT_INTEGRITY_BLOCKED');
      assert.deepEqual(result.intendedWriteSet, []);
      assert.equal(totalChanges(context.db) - changesBefore, 0);
      assert.equal(postingGraphSnapshot(context.db), graphBefore);
    } finally {
      context.db.close();
    }
  });
}

for (const idMutation of ['canonical ID', 'audit ID']) {
  test(`P1-03 C1 verifies coordinated ${idMutation} and reciprocal bindings`, () => {
    const context = createPr9bContext();
    try {
      context.postingRepository.post(postingCommand(context));
      context.db.pragma('foreign_keys = OFF');
      try {
        if (idMutation === 'canonical ID') {
          const id = '21000000-0000-4000-8000-000000000001';
          mutateProtectedRow(context.db, 'canonical_receivables', 'id = ?', [id]);
          mutateProtectedRow(context.db, 'canonical_receivable_posting_operations', 'canonicalReceivableId = ?', [id]);
          mutateProtectedRow(context.db, 'financial_audit_events', 'aggregateId = ?', [id]);
        } else {
          const id = '21000000-0000-4000-8000-000000000002';
          mutateProtectedRow(context.db, 'financial_audit_events', 'id = ?', [id]);
          mutateProtectedRow(context.db, 'canonical_receivable_posting_operations', 'financialAuditEventId = ?', [id]);
        }
      } finally {
        context.db.pragma('foreign_keys = ON');
      }
      assert.deepEqual(context.db.pragma('foreign_key_check'), []);
      const graphBefore = postingGraphSnapshot(context.db);
      const changesBefore = totalChanges(context.db);
      const result = context.eligibilityRepository.orchestratePostingDenial({
        assertedDenialCause: 'PR8_EVIDENCE_MISMATCH',
        denialAttemptId: '21000000-0000-4000-8000-000000000099',
        postingCommand: postingCommand(context),
      });
      assert.equal(result.classification, 'C2');
      assert.equal(result.outcome, 'PRIMARY_RESULT_INTEGRITY_BLOCKED');
      assert.equal(totalChanges(context.db) - changesBefore, 0);
      assert.equal(postingGraphSnapshot(context.db), graphBefore);
    } finally {
      context.db.close();
    }
  });
}

function seedUnrelatedCanonicalCollision(context, id) {
  const timestamp = context.event.createdAt;
  insertProtectedRow(context.db, 'canonical_receivables', {
    id,
    companyId: context.event.companyId,
    branchId: context.event.branchId,
    clientId: context.event.clientId,
    contractId: null,
    rentalId: null,
    sourceDocumentType: 'unrelated_fixture',
    sourceDocumentId: `unrelated-${id}`,
    sourceLineId: null,
    sourceSystem: 'unrelated.fixture.v1',
    externalId: null,
    idempotencyKey: `unrelated-${id}`,
    currency: 'RUB',
    originalAmountMinor: 1,
    issuedAt: timestamp,
    postedAt: null,
    contractualDueDate: null,
    dueDateProvenance: 'unknown',
    companyTimezone: context.event.companyTimezoneSnapshot,
    workflowStatus: 'draft',
    cancellationReason: null,
    description: 'collision fixture',
    createdAt: timestamp,
    updatedAt: timestamp,
    cancelledAt: null,
    closedAt: null,
    writtenOffAt: null,
    version: 1,
  });
}

test('P2-04 fixed repository clock and UUID generator produce stable exact evidence', () => {
  const context = createPr9bContext();
  try {
    const fixedClock = Date.parse(context.event.createdAt);
    const ids = [
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
    ];
    const repository = createPostingRepositoryForTest(context, {
      clock: () => fixedClock,
      uuid: uuidSequence(ids),
    });
    const created = repository.post(postingCommand(context));
    assert.equal(created.outcome, 'POSTED');
    assert.equal(created.evidence.canonicalReceivableId, ids[0]);
    assert.equal(created.evidence.operationId, ids[1]);
    assert.equal(created.evidence.financialAuditEventId, ids[2]);
    const receivable = context.db.prepare('SELECT * FROM canonical_receivables WHERE id = ?').get(ids[0]);
    assert.equal(receivable.createdAt, new Date(fixedClock).toISOString());
    const replay = repository.post(postingCommand(context));
    assert.equal(replay.outcome, 'EXACT_COMMITTED_RESULT');
    assert.deepEqual(replay.evidence, created.evidence);
  } finally {
    context.db.close();
  }
});

test('P2-04 repository-owned clock and UUID propagate through bounded C denial persistence', () => {
  const context = createPr9bContext();
  try {
    mutatePr8CandidateForPostingConflict(context);
    const fixedClock = Date.parse(context.event.createdAt);
    const denialAttemptId = '30000000-0000-4000-8000-000000000004';
    const repository = createPostingRepositoryForTest(context, {
      clock: () => fixedClock,
      uuid: () => denialAttemptId,
    });
    const result = repository.post(postingCommand(context));
    assert.equal(result.outcome, 'DENIAL_PERSISTED');
    const conflict = context.db.prepare(
      'SELECT * FROM canonical_receivable_posting_conflicts',
    ).get();
    assert.equal(conflict.denialAttemptId, denialAttemptId);
    assert.equal(conflict.deniedAttemptedAt, new Date(fixedClock).toISOString());
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
  } finally {
    context.db.close();
  }
});

test('P2-04 repository clock failure has exact precedence and zero DML', () => {
  const context = createPr9bContext();
  try {
    let uuidCalls = 0;
    const repository = createPostingRepositoryForTest(context, {
      clock() {
        throw new Error('clock unavailable');
      },
      uuid() {
        uuidCalls += 1;
        return '30000000-0000-4000-8000-000000000010';
      },
    });
    const graphBefore = postingGraphSnapshot(context.db);
    assert.throws(
      () => repository.post(postingCommand(context)),
      error => error.code === 'CANONICAL_REPOSITORY_CLOCK_FAILED',
    );
    assert.equal(uuidCalls, 0);
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
  } finally {
    context.db.close();
  }
});

for (const failureCall of [1, 2, 3]) {
  test(`P2-04 UUID generator failure at call ${failureCall} rolls back with zero DML`, () => {
    const context = createPr9bContext();
    try {
      let calls = 0;
      const repository = createPostingRepositoryForTest(context, {
        uuid() {
          calls += 1;
          if (calls === failureCall) throw new Error('uuid unavailable');
          return `31000000-0000-4000-8000-00000000000${calls}`;
        },
      });
      const graphBefore = postingGraphSnapshot(context.db);
      assert.throws(
        () => repository.post(postingCommand(context)),
        error => error.code === 'CANONICAL_POSTING_ID_GENERATION_FAILED',
      );
      assert.equal(calls, failureCall);
      assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
      assert.equal(postingGraphSnapshot(context.db), graphBefore);
    } finally {
      context.db.close();
    }
  });
}

for (const [name, collisionPosition] of [
  ['canonical ID', 0],
  ['operation ID', 1],
  ['audit ID', 2],
]) {
  test(`P2-04 ${name} collision is deterministic and produces zero DML`, () => {
    const context = createPr9bContext();
    try {
      const collisionId = `32000000-0000-4000-8000-00000000000${collisionPosition + 1}`;
      seedUnrelatedCanonicalCollision(context, collisionId);
      const ids = [
        '32000000-0000-4000-8000-000000000011',
        '32000000-0000-4000-8000-000000000012',
        '32000000-0000-4000-8000-000000000013',
      ];
      ids[collisionPosition] = collisionId;
      const repository = createPostingRepositoryForTest(context, {
        uuid: uuidSequence(ids),
      });
      const graphBefore = postingGraphSnapshot(context.db);
      assert.throws(
        () => repository.post(postingCommand(context)),
        error => error.code === 'CANONICAL_REPOSITORY_ID_COLLISION',
      );
      assert.deepEqual(primaryCounts(context.db), {
        ...ZERO_PRIMARY_COUNTS,
        canonical_receivables: 1,
      });
      assert.equal(postingGraphSnapshot(context.db), graphBefore);
    } finally {
      context.db.close();
    }
  });
}

test('P2-04 repeated UUID output is rejected before the first primary INSERT', () => {
  const context = createPr9bContext();
  try {
    const repository = createPostingRepositoryForTest(context, {
      uuid: () => '33000000-0000-4000-8000-000000000001',
    });
    const graphBefore = postingGraphSnapshot(context.db);
    assert.throws(
      () => repository.post(postingCommand(context)),
      error => error.code === 'CANONICAL_REPOSITORY_ID_COLLISION',
    );
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
  } finally {
    context.db.close();
  }
});

test('P2-03 Phase 1 anti-join rejects an orphan canonical row with zero DML', () => {
  const context = createPr9bContext();
  try {
    const timestamp = context.event.createdAt;
    insertProtectedRow(context.db, 'canonical_receivables', {
      id: '34000000-0000-4000-8000-000000000001',
      companyId: context.event.companyId,
      branchId: context.event.branchId,
      clientId: context.event.clientId,
      contractId: context.event.contractId,
      rentalId: context.event.rentalId,
      sourceDocumentType: 'rental_service_upd',
      sourceDocumentId: context.event.rootSourceDocumentLineageId,
      sourceLineId: context.event.economicLineageKey,
      sourceSystem: 'rentcore.billing_source_authority.v1',
      externalId: context.event.economicLineageKey,
      idempotencyKey: 'hostile-orphan-canonical',
      currency: 'RUB',
      originalAmountMinor: context.event.grossAmountMinor,
      issuedAt: timestamp,
      postedAt: timestamp,
      contractualDueDate: context.event.contractualDueDate,
      dueDateProvenance: context.event.dueDateProvenance,
      companyTimezone: context.event.companyTimezoneSnapshot,
      workflowStatus: 'posted',
      cancellationReason: null,
      description: 'hostile orphan',
      createdAt: timestamp,
      updatedAt: timestamp,
      cancelledAt: null,
      closedAt: null,
      writtenOffAt: null,
      version: 1,
    });
    const graphBefore = postingGraphSnapshot(context.db);
    const changesBefore = totalChanges(context.db);
    assert.throws(
      () => context.postingRepository.post(postingCommand(context)),
      error => error.code === 'CANONICAL_POSTING_INTEGRITY_BLOCKED',
    );
    assert.equal(totalChanges(context.db) - changesBefore, 0);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
  } finally {
    context.db.close();
  }
});

test('P2-03 Phase 1 anti-join rejects an orphan initial-post audit row with zero DML', () => {
  const context = createPr9bContext();
  try {
    const timestamp = context.event.createdAt;
    insertProtectedRow(context.db, 'financial_audit_events', {
      id: '34000000-0000-4000-8000-000000000002',
      companyId: context.event.companyId,
      branchId: context.event.branchId,
      aggregateType: 'canonical_receivable',
      aggregateId: '34000000-0000-4000-8000-000000000099',
      eventType: 'canonical_receivable.initial_posted.v1',
      actorId: 'integration:rentcore-canonical-receivable-posting',
      actorType: 'integration',
      occurredAt: timestamp,
      reason: 'canonical_actual_posting_initial_post_v1',
      previousValueJson: null,
      newValueJson: '{}',
      correlationId: context.event.correlationId,
      sourceSystem: 'rentcore.billing_source_authority.v1',
      createdAt: timestamp,
    });
    const graphBefore = postingGraphSnapshot(context.db);
    const changesBefore = totalChanges(context.db);
    assert.throws(
      () => context.postingRepository.post(postingCommand(context)),
      error => error.code === 'CANONICAL_POSTING_INTEGRITY_BLOCKED',
    );
    assert.equal(totalChanges(context.db) - changesBefore, 0);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
  } finally {
    context.db.close();
  }
});

test('P2-03 partial operation/canonical/audit bindings are not treated as NO_RESULT', () => {
  const context = createPr9bContext();
  try {
    context.postingRepository.post(postingCommand(context));
    mutateProtectedRow(
      context.db,
      'canonical_receivables',
      "sourceDocumentId = 'unrelated-document', sourceLineId = 'unrelated-line', externalId = 'unrelated-line'",
    );
    const graphBefore = postingGraphSnapshot(context.db);
    const changesBefore = totalChanges(context.db);
    const result = context.postingRepository.post(postingCommand(context));
    assert.equal(result.outcome, 'PRIMARY_RESULT_INTEGRITY_BLOCKED');
    assert.deepEqual(result.intendedWriteSet, []);
    assert.equal(totalChanges(context.db) - changesBefore, 0);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
  } finally {
    context.db.close();
  }
});

test('P2-03 hostile orphan operation without canonical is rejected before posting DML', () => {
  const context = createPr9bContext();
  try {
    context.postingRepository.post(postingCommand(context));
    const receivableId = context.db.prepare(
      'SELECT canonicalReceivableId FROM canonical_receivable_posting_operations',
    ).get().canonicalReceivableId;
    deleteProtectedRows(
      context.db,
      'canonical_receivables',
      'id = ?',
      [receivableId],
    );
    assert.notDeepEqual(context.db.pragma('foreign_key_check'), []);
    const graphBefore = postingGraphSnapshot(context.db);
    const changesBefore = totalChanges(context.db);
    assert.throws(
      () => context.postingRepository.post(postingCommand(context)),
      error => error.code === 'CANONICAL_POSTING_DATABASE_FAILED',
    );
    assert.equal(totalChanges(context.db) - changesBefore, 0);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
  } finally {
    context.db.close();
  }
});

test('P2-03 final pre-commit anti-join rolls back an orphan injected after primary writes', () => {
  const context = createPr9bContext();
  try {
    const graphBefore = postingGraphSnapshot(context.db);
    const db = injectAfterAuditReread(context.db, audit => {
      insertProtectedRow(context.db, 'financial_audit_events', {
        ...audit,
        id: '34000000-0000-4000-8000-000000000003',
      });
    });
    const repository = createPostingRepositoryForTest({ ...context, db });
    assert.throws(
      () => repository.post(postingCommand(context)),
      error => error.code === 'CANONICAL_POSTING_INTEGRITY_BLOCKED',
    );
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
  } finally {
    context.db.close();
  }
});

test('P2-01 evidence digest is emitted from actual production reads and changes on read corruption', () => {
  const context = createPr9bContext();
  try {
    const fixedClock = Date.parse(context.event.createdAt);
    const admittedTrace = createEvidenceTrace();
    const admittedRepository = createPostingRepositoryForTest(context, {
      clock: () => fixedClock,
      evidenceRecorder: admittedTrace.record,
      uuid() {
        throw new Error('stop after authoritative reads');
      },
    });
    assert.throws(
      () => admittedRepository.post(postingCommand(context)),
      error => error.code === 'CANONICAL_POSTING_ID_GENERATION_FAILED',
    );
    const requiredPr6Tables = [
      'billing_source_activation_boundaries',
      'billing_source_rental_lines',
      'billing_source_effective_terms',
      'billing_source_periods',
      'billing_source_period_versions',
      'billing_source_snapshots',
      'billing_source_snapshot_evidence',
      'billing_source_upds',
      'billing_source_upd_versions',
      'billing_source_upd_lines',
      'billing_source_upd_line_versions',
      'billing_source_coverage_sets',
      'billing_source_coverage_supersessions',
      'billing_source_coverage_slices',
      'billing_source_operations',
      'billing_source_audit_events',
    ];
    const requiredPr8Tables = [
      'actual_source_dry_runs',
      'actual_source_dry_run_candidates',
      'actual_source_dry_run_inputs',
      'actual_source_dry_run_checks',
      'actual_source_dry_run_reconciliations',
      'actual_source_dry_run_diagnostics',
      'actual_source_dry_run_operations',
      'actual_source_dry_run_audit_events',
    ];
    const actualTables = new Set(admittedTrace.entries.map(entry => entry.table).filter(Boolean));
    for (const table of [...requiredPr6Tables, ...requiredPr8Tables]) {
      assert.equal(actualTables.has(table), true, `missing production read trace for ${table}`);
    }
    assert.equal(
      admittedTrace.entries.some(entry => entry.phase === 'posting_authoritative_admission'),
      true,
    );
    const admittedDigest = admittedTrace.digest();

    mutateProtectedRow(
      context.db,
      'actual_source_dry_run_checks',
      "checkHash = '0000000000000000000000000000000000000000000000000000000000000000' WHERE id = (SELECT id FROM actual_source_dry_run_checks ORDER BY id LIMIT 1)",
    );
    const deniedTrace = createEvidenceTrace();
    const deniedRepository = createPostingRepositoryForTest(context, {
      clock: () => fixedClock,
      evidenceRecorder: deniedTrace.record,
      uuid: () => '35000000-0000-4000-8000-000000000001',
    });
    const denied = callPosting(deniedRepository, postingCommand(context));
    assert.notEqual(denied.result?.outcome, 'POSTED');
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
    assert.notEqual(deniedTrace.digest(), admittedDigest);
    assert.equal(
      deniedTrace.entries.some(entry => (
        entry.table === 'actual_source_dry_run_checks'
        && entry.rows?.some(row => row.checkHash === '0'.repeat(64))
      )),
      true,
    );
    assert.equal(JSON.stringify(denied.result || denied.error).includes('evidenceRecord'), false);
  } finally {
    context.db.close();
  }
});

test('P2-01 evidence read boundary rejects reader-shaped DML before Statement.get executes', () => {
  const context = createPr9bContext();
  try {
    context.db.exec(`
      CREATE TABLE stage4_read_guard_probe (value TEXT NOT NULL);
      INSERT INTO stage4_read_guard_probe (value) VALUES ('before');
    `);
    let hostilePrepareCalls = 0;
    let hostileGetCalls = 0;
    const armedDb = new Proxy(context.db, {
      get(target, property) {
        if (property === 'prepare') {
          return sql => {
            if (
              hostilePrepareCalls === 0
              && /SELECT\s+\*\s+FROM\s+actual_receivable_eligible_events\s+WHERE\s+id\s*=\s*\?/i.test(String(sql))
              && /companyId\s*=\s*\?/i.test(String(sql))
              && /branchId\s*=\s*\?/i.test(String(sql))
            ) {
              hostilePrepareCalls += 1;
              const statement = target.prepare(`
                UPDATE stage4_read_guard_probe SET value = 'mutated'
                WHERE ? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL
                RETURNING value
              `);
              return new Proxy(statement, {
                get(statementTarget, statementProperty) {
                  const value = Reflect.get(statementTarget, statementProperty, statementTarget);
                  if (statementProperty === 'get') {
                    return (...args) => {
                      hostileGetCalls += 1;
                      return value.apply(statementTarget, args);
                    };
                  }
                  return typeof value === 'function' ? value.bind(statementTarget) : value;
                },
              });
            }
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const trace = createEvidenceTrace();
    const repository = createPostingRepositoryForTest({ ...context, db: armedDb }, {
      evidenceRecorder: trace.record,
    });
    assert.throws(() => repository.post(postingCommand(context)));
    assert.equal(hostilePrepareCalls, 1);
    assert.equal(hostileGetCalls, 0);
    assert.equal(
      context.db.prepare('SELECT value FROM stage4_read_guard_probe').get().value,
      'before',
    );
    assert.equal(
      trace.entries.some(entry => entry.table === 'stage4_read_guard_probe'),
      false,
    );
  } finally {
    context.db.close();
  }
});

for (const [repositoryName, createRepository] of [
  ['posting', createPostingRepositoryForTest],
  ['eligibility', createInstrumentedEligibilityRepository],
]) {
  test(`P2-01 ${repositoryName} evidence pragma boundary rejects a disguised write before Statement.all executes`, () => {
    const context = createPr9bContext();
    try {
      const beforeVersion = context.db.pragma('user_version', { simple: true });
      let hostilePrepareCalls = 0;
      let hostileAllCalls = 0;
      const armedDb = new Proxy(context.db, {
        get(target, property) {
          if (property === 'prepare') {
            return sql => {
              if (
                hostilePrepareCalls === 0
                && /^\s*PRAGMA\s+foreign_key_check\s*$/i.test(String(sql))
              ) {
                hostilePrepareCalls += 1;
                const statement = target.prepare('PRAGMA user_version=7');
                return new Proxy(statement, {
                  get(statementTarget, statementProperty) {
                    const value = Reflect.get(statementTarget, statementProperty, statementTarget);
                    if (statementProperty === 'all') {
                      return (...args) => {
                        hostileAllCalls += 1;
                        return value.apply(statementTarget, args);
                      };
                    }
                    return typeof value === 'function' ? value.bind(statementTarget) : value;
                  },
                });
              }
              return target.prepare(sql);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const trace = createEvidenceTrace();
      assert.throws(
        () => createRepository({ ...context, db: armedDb }, { evidenceRecorder: trace.record }),
        error => error.code === 'SQLITE_READONLY_STATEMENT_REQUIRED',
      );
      assert.equal(hostilePrepareCalls, 1);
      assert.equal(hostileAllCalls, 0);
      assert.equal(context.db.pragma('user_version', { simple: true }), beforeVersion);
      assert.equal(trace.entries.some(entry => entry.table === 'stage4_read_guard_probe'), false);
    } finally {
      context.db.close();
    }
  });
}

for (const table of [
  'billing_source_activation_boundaries',
  'billing_source_rental_lines',
  'billing_source_effective_terms',
  'billing_source_periods',
  'billing_source_period_versions',
  'billing_source_snapshots',
  'billing_source_snapshot_evidence',
  'billing_source_upds',
  'billing_source_upd_versions',
  'billing_source_upd_lines',
  'billing_source_upd_line_versions',
  'billing_source_coverage_sets',
  'billing_source_coverage_slices',
  'billing_source_operations',
  'billing_source_audit_events',
]) {
  test(`P1-02 complete PR6 closure detects one-field ${table} tampering`, () => {
    const context = createPr9bContext();
    try {
      mutateProtectedRow(context.db, table, "createdAt = '2000-01-01T00:00:00.000Z'");
      const invocation = callPosting(context.postingRepository, postingCommand(context));
      assert.notEqual(invocation.result?.outcome, 'POSTED');
      assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
    } finally {
      context.db.close();
    }
  });
}

test('P1-02 complete PR6 closure observes a new coverage supersession relation', () => {
  const context = createPr9bContext();
  try {
    const operation = context.db.prepare(`
      SELECT * FROM billing_source_operations
      ORDER BY id LIMIT 1
    `).get();
    const coverage = context.db.prepare('SELECT * FROM billing_source_coverage_sets').get();
    assert.ok(operation);
    insertProtectedRow(context.db, 'billing_source_coverage_supersessions', {
      id: 'hostile-supersession',
      companyId: coverage.companyId,
      branchId: coverage.branchId,
      originalCoverageSetId: coverage.id,
      replacementCoverageSetId: null,
      action: 'cancelled',
      reasonCode: 'HOSTILE_SUPERSESSION',
      reasonText: 'hostile supersession fixture',
      operationId: operation.id,
      actorPrincipalId: operation.actorPrincipalId,
      actorMembershipId: operation.actorMembershipId,
      actorMembershipVersion: operation.actorMembershipVersion,
      capabilityCatalogVersion: operation.capabilityCatalogVersion,
      capabilityKey: operation.capabilityKey,
      sourceEventId: 'hostile-supersession-event',
      sourceEventVersion: 1,
      sourceHash: '0'.repeat(64),
      schemaVersion: 1,
      createdAt: context.event.createdAt,
    });
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
    const invocation = callPosting(context.postingRepository, postingCommand(context));
    assert.notEqual(invocation.result?.outcome, 'POSTED');
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
  } finally {
    context.db.close();
  }
});

test('P1-02 PR5 company timezone authority is reread under the posting lock', () => {
  const context = createPr9bContext();
  try {
    mutateProtectedRow(context.db, 'canonical_companies', "receivablesTimezone = 'UTC'");
    const invocation = callPosting(context.postingRepository, postingCommand(context));
    assert.notEqual(invocation.result?.outcome, 'POSTED');
    assert.deepEqual(primaryCounts(context.db), ZERO_PRIMARY_COUNTS);
  } finally {
    context.db.close();
  }
});
