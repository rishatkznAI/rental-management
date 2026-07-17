import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  closePlan,
  conductPlan,
  createBillingSourceContext,
  formPlan,
  hash,
  insertActivationBoundary,
  sourceRows,
} from './billing-source-authority-fixtures.js';

const require = createRequire(import.meta.url);
const {
  BILLING_SOURCE_AUTHORITY_TABLES,
} = require('../server/lib/billing-source-authority-schema.js');
const {
  BillingSourceAuthorityError,
  computeEvidenceSetHash,
  createBillingSourceCommandContext,
  materializeBillingSourceCommandPlan,
} = require('../server/lib/billing-source-authority-domain.js');
const {
  createBillingSourceAuthorityRepository,
} = require('../server/lib/billing-source-authority-repository.js');
const {
  createBillingSourceAuthorityReadRepository,
  createBillingSourceInspectionScope,
} = require('../server/lib/billing-source-authority-read-repository.js');
const {
  createTrustedUserActorContext,
} = require('../server/lib/platform-identity-repository.js');
const {
  resolveTrustedScope,
} = require('../server/lib/platform-authorization.js');

function code(error, expected) {
  return error instanceof BillingSourceAuthorityError && error.code === expected;
}

function setupClosed(options) {
  const context = createBillingSourceContext(options);
  insertActivationBoundary(context);
  const result = context.service.closeBillingPeriod(context.commandContext, closePlan());
  return { context, result, source: sourceRows(context) };
}

function tableCounts(db) {
  return Object.fromEntries(BILLING_SOURCE_AUTHORITY_TABLES.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

function replacementCommand(context, overrides = {}) {
  const upd = context.db.prepare('SELECT * FROM billing_source_upds ORDER BY createdAt, id LIMIT 1').get();
  const latestUpdVersion = context.db.prepare(`
    SELECT * FROM billing_source_upd_versions
    WHERE updId = ? ORDER BY version DESC, id DESC LIMIT 1
  `).get(upd.id);
  const line = context.db.prepare('SELECT * FROM billing_source_upd_lines WHERE updId = ? ORDER BY id LIMIT 1').get(upd.id);
  const latestLineVersion = context.db.prepare(`
    SELECT * FROM billing_source_upd_line_versions
    WHERE updLineId = ? ORDER BY version DESC, id DESC LIMIT 1
  `).get(line.id);
  const coverage = {
    ...formPlan(context).coverage,
    supersedesCoverageSetIds: overrides.supersedesCoverageSetIds || [],
    ...(overrides.coverage || {}),
  };
  return {
    operationType: 'correct_upd',
    idempotencyKey: overrides.idempotencyKey || 'replace-upd-helper',
    updId: upd.id,
    expectedUpdVersion: Number(latestUpdVersion.version),
    action: 'replace',
    reasonCode: 'ACCOUNTING_REPLACE',
    reasonText: 'Explicit replacement evidence',
    sourceEventId: overrides.sourceEventId || 'replace-helper-event',
    sourceEventVersion: 1,
    sourceHash: hash(overrides.sourceEventId || 'replace-helper-event'),
    lines: [{
      id: line.id,
      sourceLineRef: line.sourceLineRef,
      sourceLineIdentityKind: line.sourceLineIdentityKind,
      displayPosition: Number(latestLineVersion.version) + 1,
      description: 'Corrected display metadata',
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
      sourceVersion: Number(latestLineVersion.version) + 1,
      sourceHash: hash(`replacement-line-${Number(latestLineVersion.version) + 1}`),
    }],
    coverage,
  };
}

test('close atomically creates stable line, terms, period, version, snapshot, evidence, operation, and audit', () => {
  const context = createBillingSourceContext();
  try {
    insertActivationBoundary(context);
    const legacyBefore = context.db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json;
    const result = context.service.closeBillingPeriod(context.commandContext, closePlan({
      auditMetadata: { adapter: 'isolated_test', evidenceCount: 1 },
    }));
    assert.equal(result.replayed, false);
    assert.equal(result.aggregateType, 'billing_period');
    assert.match(result.aggregateId, /^billing-source-period-/);
    assert.deepEqual({
      rentalLines: context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_rental_lines').get().count,
      terms: context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_effective_terms').get().count,
      periods: context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_periods').get().count,
      versions: context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_period_versions').get().count,
      snapshots: context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_snapshots').get().count,
      evidence: context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_snapshot_evidence').get().count,
      operations: context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_operations').get().count,
      audit: context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_audit_events').get().count,
    }, {
      rentalLines: 1,
      terms: 1,
      periods: 1,
      versions: 1,
      snapshots: 1,
      evidence: 1,
      operations: 1,
      audit: 1,
    });
    const line = context.db.prepare('SELECT * FROM billing_source_rental_lines').get();
    assert.match(line.id, /^billing-source-rental-line-/);
    assert.equal(line.rentalId, 'rental-1');
    assert.equal(line.clientId, 'client-1');
    const snapshot = context.db.prepare('SELECT * FROM billing_source_snapshots').get();
    assert.equal(snapshot.companyTimezone, 'Europe/Moscow');
    assert.equal(snapshot.currency, 'RUB');
    assert.equal(snapshot.preDiscountNetMinor - snapshot.discountMinor, snapshot.netMinor);
    assert.equal(snapshot.netMinor + snapshot.vatMinor, snapshot.grossMinor);
    assert.equal(context.db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json, legacyBefore);
    assert.equal(context.db.prepare("SELECT 1 FROM app_data WHERE name IN ('rentals', 'gantt_rentals')").get(), undefined);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.close();
  }
});

test('exact close replay returns original logical result and writes no source or audit rows', () => {
  const context = createBillingSourceContext();
  try {
    insertActivationBoundary(context);
    const command = closePlan();
    const first = context.service.closeBillingPeriod(context.commandContext, command);
    const before = tableCounts(context.db);
    const second = context.service.closeBillingPeriod(context.commandContext, command);
    assert.equal(second.replayed, true);
    assert.equal(second.operationId, first.operationId);
    assert.equal(second.aggregateId, first.aggregateId);
    assert.equal(second.fingerprint, first.fingerprint);
    assert.deepEqual(tableCounts(context.db), before);
  } finally {
    context.close();
  }
});

test('repository owns evidence-set hashing, persisted reconstruction, and expected-hash assertions', async t => {
  const first = closePlan().evidence[0];
  const second = {
    ...first,
    evidenceType: 'contract',
    sourceId: 'contract-source-1',
    sourceEventId: 'contract-evidence-event-1',
    authorityPolicyRef: 'contract-authority-policy-test-v1',
    evidenceHash: hash('contract-evidence-1'),
  };
  const expectedEvidenceSetHash = computeEvidenceSetHash([first, second]);

  await t.test('correct expected hash and reversed input order persist the same repository hash and result fingerprint', () => {
    const left = createBillingSourceContext();
    const right = createBillingSourceContext();
    try {
      insertActivationBoundary(left);
      insertActivationBoundary(right);
      const leftResult = left.service.closeBillingPeriod(left.commandContext, closePlan({
        evidence: [first, second],
        expectedEvidenceSetHash,
      }));
      const leftReplay = left.service.closeBillingPeriod(left.commandContext, closePlan({
        evidence: [second, first],
        expectedEvidenceSetHash,
      }));
      right.service.closeBillingPeriod(right.commandContext, closePlan({
        evidence: [second, first],
        expectedEvidenceSetHash,
      }));
      const leftSnapshot = left.db.prepare('SELECT * FROM billing_source_snapshots').get();
      const rightSnapshot = right.db.prepare('SELECT * FROM billing_source_snapshots').get();
      assert.equal(leftSnapshot.evidenceSetHash, expectedEvidenceSetHash);
      assert.equal(rightSnapshot.evidenceSetHash, expectedEvidenceSetHash);
      assert.equal(leftReplay.replayed, true);
      assert.equal(leftReplay.fingerprint, leftResult.fingerprint);
      const columns = `
        evidenceType, sourceSystem, sourceId, sourceVersion, sourceEventId,
        sourceEventVersion, coveredStartDate, coveredEndDateExclusive,
        authorityStatus, authorityPolicyRef, evidenceHash
      `;
      const persisted = left.db.prepare(`SELECT ${columns} FROM billing_source_snapshot_evidence`).all();
      assert.equal(computeEvidenceSetHash(persisted), leftSnapshot.evidenceSetHash);
      assert.throws(() => left.db.prepare(`
        INSERT INTO billing_source_snapshot_evidence (
          id, companyId, branchId, snapshotId, evidenceType, sourceSystem,
          sourceId, sourceVersion, sourceEventId, sourceEventVersion,
          coveredStartDate, coveredEndDateExclusive, authorityStatus,
          authorityPolicyRef, evidenceHash, schemaVersion, createdAt
        )
        SELECT 'duplicate-evidence-id', companyId, branchId, snapshotId, evidenceType, sourceSystem,
               sourceId, sourceVersion, sourceEventId, sourceEventVersion,
               coveredStartDate, coveredEndDateExclusive, authorityStatus,
               authorityPolicyRef, evidenceHash, schemaVersion, createdAt
        FROM billing_source_snapshot_evidence
        LIMIT 1
      `).run(), /UNIQUE constraint failed/);
      const leftIds = left.db.prepare('SELECT id FROM billing_source_snapshot_evidence ORDER BY id').all();
      const rightIds = right.db.prepare('SELECT id FROM billing_source_snapshot_evidence ORDER BY id').all();
      assert.notDeepEqual(leftIds, rightIds);
    } finally {
      left.close();
      right.close();
    }
  });

  await t.test('arbitrary expected hash rejects the complete close before any source commit', () => {
    const context = createBillingSourceContext();
    try {
      insertActivationBoundary(context);
      const before = tableCounts(context.db);
      assert.throws(
        () => context.service.closeBillingPeriod(context.commandContext, closePlan({
          evidence: [first, second],
          expectedEvidenceSetHash: hash('arbitrary-caller-assertion'),
        })),
        error => code(error, 'BILLING_SOURCE_EVIDENCE_SET_HASH_MISMATCH'),
      );
      assert.deepEqual(tableCounts(context.db), before);
      assert.equal(context.db.inTransaction, false);
    } finally {
      context.close();
    }
  });
});

test('reopen and standalone coverage commands replay exactly without new source or audit rows', async t => {
  await t.test('reopen_billing_period', () => {
    const { context, source } = setupClosed();
    try {
      const command = {
        operationType: 'reopen_billing_period',
        idempotencyKey: 'reopen-replay',
        periodId: source.period.id,
        expectedPeriodVersion: 1,
        reasonCode: 'SOURCE_CORRECTION',
        reasonText: 'Replay-safe reopen',
        sourceEventId: 'reopen-replay-event',
        sourceEventVersion: 1,
        sourceHash: hash('reopen-replay-event'),
      };
      const first = context.service.reopenBillingPeriod(context.commandContext, command);
      const before = tableCounts(context.db);
      const replay = context.service.reopenBillingPeriod(context.commandContext, command);
      assert.equal(replay.replayed, true);
      assert.equal(replay.operationId, first.operationId);
      assert.equal(replay.fingerprint, first.fingerprint);
      assert.deepEqual(tableCounts(context.db), before);
    } finally {
      context.close();
    }
  });

  await t.test('record_upd_coverage', () => {
    const { context } = setupClosed();
    try {
      context.service.formUpd(context.commandContext, formPlan(context, { withoutCoverage: true }));
      const upd = context.db.prepare('SELECT * FROM billing_source_upds').get();
      const formed = context.db.prepare("SELECT * FROM billing_source_upd_versions WHERE state = 'formed'").get();
      context.service.conductUpd(context.commandContext, conductPlan(context));
      const command = {
        operationType: 'record_upd_coverage',
        idempotencyKey: 'coverage-replay',
        updId: upd.id,
        formedUpdVersionId: formed.id,
        expectedUpdVersion: 3,
        coverage: formPlan(context).coverage,
        reasonCode: 'COVERAGE_RECORDED',
        reasonText: 'Explicit standalone coverage evidence',
        sourceEventId: 'coverage-replay-event',
        sourceEventVersion: 1,
        sourceHash: hash('coverage-replay-event'),
      };
      const first = context.service.recordUpdCoverage(context.commandContext, command);
      const before = tableCounts(context.db);
      const replay = context.service.recordUpdCoverage(context.commandContext, command);
      assert.equal(replay.replayed, true);
      assert.equal(replay.operationId, first.operationId);
      assert.equal(replay.fingerprint, first.fingerprint);
      assert.deepEqual(tableCounts(context.db), before);
    } finally {
      context.close();
    }
  });
});

test('same operation key with different content, actor, or concrete branch is an idempotency conflict', () => {
  const context = createBillingSourceContext({ branchIds: ['branch-a-1', 'branch-a-2'] });
  try {
    insertActivationBoundary(context);
    context.service.closeBillingPeriod(context.commandContext, closePlan());
    const changed = closePlan({ grossMinor: 120_001, sourceIntegrityStatus: 'blocked', blockerReasonCodes: ['MISMATCH'] });
    assert.throws(
      () => context.service.closeBillingPeriod(context.commandContext, changed),
      error => code(error, 'BILLING_SOURCE_IDEMPOTENCY_CONFLICT'),
    );
    const otherBranchContext = createBillingSourceCommandContext(context.platformScope, {
      branchId: 'branch-a-2',
      correlationId: 'billing-source-other-branch',
    });
    assert.throws(
      () => context.service.closeBillingPeriod(otherBranchContext, closePlan()),
      error => code(error, 'BILLING_SOURCE_IDEMPOTENCY_CONFLICT'),
    );
    const actor = createTrustedUserActorContext({
      principalId: 'U-billing',
      correlationId: 'billing-source-create-other-membership',
    });
    context.platformRepository.createMembership({
      id: 'membership-other',
      companyId: 'company-a',
      principalId: 'U-other',
      status: 'active',
      roleTemplateKey: 'billing-source-test',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: actor,
      reason: 'isolated-idempotency-actor-test',
    });
    const otherActorScope = resolveTrustedScope({
      req: { user: { userId: 'U-other' } },
      repository: context.platformRepository,
      readUsers: context.readUsers,
      nowIso: () => '2026-07-17T12:30:00.000Z',
    });
    const otherActorContext = createBillingSourceCommandContext(otherActorScope, {
      branchId: 'branch-a-1',
      correlationId: 'billing-source-other-actor',
    });
    assert.throws(
      () => context.service.closeBillingPeriod(otherActorContext, closePlan()),
      error => code(error, 'BILLING_SOURCE_IDEMPOTENCY_CONFLICT'),
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_operations').get().count, 1);
  } finally {
    context.close();
  }
});

test('stable line binding is reusable across periods, conflicting immutable content is rejected, and distinct explicit lines remain distinct', () => {
  const { context, source } = setupClosed();
  try {
    const terms = context.db.prepare('SELECT * FROM billing_source_effective_terms').get();
    context.service.closeBillingPeriod(context.commandContext, closePlan({
      idempotencyKey: 'close-period-2',
      periodStartDate: '2026-09-01',
      periodEndDateExclusive: '2026-10-01',
      rentalLineId: source.rentalLine.id,
      effectiveTermsId: terms.id,
      sourceEventId: 'close-event-2',
      sourceHash: hash('close-event-2'),
      snapshotSourceHash: hash('snapshot-2'),
    }));
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_rental_lines').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_periods').get().count, 2);

    const conflict = closePlan({
      idempotencyKey: 'line-conflict',
      periodStartDate: '2026-10-01',
      periodEndDateExclusive: '2026-11-01',
      rentalLineId: source.rentalLine.id,
      effectiveTermsId: terms.id,
      equipmentId: 'equipment-conflict',
      sourceEventId: 'close-event-conflict',
      sourceHash: hash('close-event-conflict'),
    });
    assert.throws(
      () => context.service.closeBillingPeriod(context.commandContext, conflict),
      error => code(error, 'BILLING_SOURCE_RENTAL_LINE_CONFLICT'),
    );

    context.service.closeBillingPeriod(context.commandContext, closePlan({
      idempotencyKey: 'distinct-line',
      rentalLineId: undefined,
      sourceLineRef: 'rental-line-source-2',
      equipmentId: 'equipment-2',
      termsSourceRef: 'terms-source-2',
      sourceEventId: 'close-event-line-2',
      sourceHash: hash('close-event-line-2'),
      snapshotSourceHash: hash('snapshot-line-2'),
    }));
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_rental_lines').get().count, 2);
    assert.equal(new Set(context.db.prepare('SELECT id FROM billing_source_rental_lines').all().map(row => row.id)).size, 2);
  } finally {
    context.close();
  }
});

test('effective terms append exact versions, preserve predecessor, and reject stale or split-period coverage', () => {
  const { context, source } = setupClosed();
  try {
    context.service.closeBillingPeriod(context.commandContext, closePlan({
      idempotencyKey: 'terms-v2-close',
      periodStartDate: '2026-09-01',
      periodEndDateExclusive: '2026-10-01',
      rentalLineId: source.rentalLine.id,
      expectedLatestTermsVersion: 1,
      termsFrom: '2026-09-01',
      termsTo: '2026-11-01',
      termsSourceRef: 'terms-source-2',
      termsSourceVersion: 2,
      rateAmountMinor: 110_000,
      sourceEventId: 'close-with-terms-v2',
      sourceHash: hash('close-with-terms-v2'),
      snapshotSourceHash: hash('snapshot-v2'),
    }));
    const terms = context.db.prepare('SELECT * FROM billing_source_effective_terms ORDER BY version').all();
    assert.deepEqual(terms.map(row => row.version), [1, 2]);
    assert.equal(terms[1].supersedesTermsVersionId, terms[0].id);
    assert.equal(terms[0].rateAmountMinor, 100_000);
    assert.equal(terms[1].rateAmountMinor, 110_000);

    assert.throws(() => context.service.closeBillingPeriod(context.commandContext, closePlan({
      idempotencyKey: 'stale-terms',
      periodStartDate: '2026-10-01',
      periodEndDateExclusive: '2026-11-01',
      rentalLineId: source.rentalLine.id,
      expectedLatestTermsVersion: 1,
      termsFrom: '2026-10-01',
      termsTo: '2026-12-01',
      termsSourceRef: 'terms-source-stale',
      sourceEventId: 'stale-terms-event',
      sourceHash: hash('stale-terms-event'),
    })), error => code(error, 'BILLING_SOURCE_TERMS_STALE'));

    assert.throws(() => context.service.closeBillingPeriod(context.commandContext, closePlan({
      idempotencyKey: 'split-terms',
      sourceLineRef: 'rental-line-split',
      equipmentId: 'equipment-split',
      termsFrom: '2026-08-15',
      termsTo: '2026-10-01',
      termsSourceRef: 'terms-source-split',
      sourceEventId: 'split-terms-event',
      sourceHash: hash('split-terms-event'),
    })), error => code(error, 'BILLING_SOURCE_TERMS_COVERAGE_INVALID'));
  } finally {
    context.close();
  }
});

test('period activation, adjacency, overlap, and close/reopen/re-close lifecycle are fail-closed and append-only', () => {
  const { context, source } = setupClosed();
  try {
    const originalSnapshotId = source.snapshot.id;
    const reopen = {
      operationType: 'reopen_billing_period',
      idempotencyKey: 'reopen-period-1',
      periodId: source.period.id,
      expectedPeriodVersion: 1,
      reasonCode: 'SOURCE_CORRECTION',
      reasonText: 'Explicit isolated correction',
      sourceEventId: 'reopen-event-1',
      sourceEventVersion: 1,
      sourceHash: hash('reopen-event-1'),
    };
    const reopened = context.service.reopenBillingPeriod(context.commandContext, reopen);
    assert.equal(reopened.version, 2);
    assert.throws(
      () => context.service.reopenBillingPeriod(context.commandContext, { ...reopen, idempotencyKey: 'reopen-again', expectedPeriodVersion: 2 }),
      error => code(error, 'BILLING_SOURCE_PERIOD_TRANSITION_INVALID'),
    );
    const terms = context.db.prepare('SELECT * FROM billing_source_effective_terms').get();
    const reclosed = context.service.closeBillingPeriod(context.commandContext, closePlan({
      idempotencyKey: 'reclose-period-1',
      periodId: source.period.id,
      rentalLineId: source.rentalLine.id,
      effectiveTermsId: terms.id,
      expectedPeriodVersion: 2,
      sourceEventId: 'reclose-event-1',
      sourceHash: hash('reclose-event-1'),
      snapshotSourceHash: hash('snapshot-reclose-1'),
    }));
    assert.equal(reclosed.version, 3);
    const versions = context.db.prepare('SELECT * FROM billing_source_period_versions ORDER BY version').all();
    assert.deepEqual(versions.map(row => row.eventType), ['closed', 'reopened', 'closed']);
    assert.equal(versions[0].snapshotId, originalSnapshotId);
    assert.notEqual(versions[2].snapshotId, originalSnapshotId);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_snapshots').get().count, 2);

    const beforeBoundary = closePlan({
      idempotencyKey: 'before-boundary',
      sourceLineRef: 'line-before-boundary',
      equipmentId: 'equipment-before-boundary',
      periodStartDate: '2026-07-01',
      periodEndDateExclusive: '2026-08-01',
      termsFrom: '2026-07-01',
      termsTo: '2026-09-01',
      termsSourceRef: 'terms-before-boundary',
      sourceEventId: 'before-boundary-event',
      sourceHash: hash('before-boundary-event'),
    });
    assert.throws(
      () => context.service.closeBillingPeriod(context.commandContext, beforeBoundary),
      error => code(error, 'BILLING_SOURCE_ACTIVATION_BOUNDARY'),
    );
  } finally {
    context.close();
  }
});

test('form records draft then formed, stable lines, deterministic validated mapping, and no canonical row', () => {
  const { context } = setupClosed();
  try {
    const command = formPlan(context);
    const duplicate = formPlan(context, { idempotencyKey: 'duplicate-source-line-ref' });
    duplicate.lines.push({
      ...duplicate.lines[0],
      sourceLineIdentityKind: 'source_event_line_id',
    });
    assert.throws(
      () => context.service.formUpd(context.commandContext, duplicate),
      error => code(error, 'BILLING_SOURCE_DUPLICATE_UPD_LINE'),
    );
    const formed = context.service.formUpd(context.commandContext, command);
    assert.equal(formed.version, 2);
    assert.deepEqual(
      context.db.prepare('SELECT version, state FROM billing_source_upd_versions ORDER BY version').all(),
      [{ version: 1, state: 'draft' }, { version: 2, state: 'formed' }],
    );
    const logicalLine = context.db.prepare('SELECT * FROM billing_source_upd_lines').get();
    const lineVersion = context.db.prepare('SELECT * FROM billing_source_upd_line_versions').get();
    assert.match(logicalLine.id, /^billing-source-upd-line-/);
    assert.equal(logicalLine.sourceLineRef, 'upd-line-source-1');
    assert.equal(lineVersion.netMinor + lineVersion.vatMinor, lineVersion.grossMinor);
    const coverage = context.db.prepare('SELECT * FROM billing_source_coverage_sets').get();
    const slice = context.db.prepare('SELECT * FROM billing_source_coverage_slices').get();
    assert.equal(coverage.status, 'validated');
    assert.equal(coverage.netDeltaMinor, 0);
    assert.match(coverage.mappingHash, /^[a-f0-9]{64}$/);
    assert.equal(slice.updLineId, logicalLine.id);
    assert.equal(slice.sliceStartDate, '2026-08-01');
    assert.equal(slice.sliceEndDateExclusive, '2026-09-01');
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivables').get().count, 0);
    const before = tableCounts(context.db);
    const replay = context.service.formUpd(context.commandContext, command);
    assert.equal(replay.replayed, true);
    assert.deepEqual(tableCounts(context.db), before);
  } finally {
    context.close();
  }
});

test('coverage rejects open/reopened periods, blocked source, scope mismatch, overlap, and monetary mismatch', async t => {
  await t.test('blocked snapshot cannot enter validated mapping', () => {
    const context = createBillingSourceContext();
    try {
      insertActivationBoundary(context);
      context.service.closeBillingPeriod(context.commandContext, closePlan({
        sourceIntegrityStatus: 'blocked',
        blockerReasonCodes: ['VAT_UNRESOLVED'],
        policyResolutionStatus: 'unresolved',
        unresolvedReasonCodes: ['VAT_UNRESOLVED'],
        evidenceAuthorityStatus: 'unresolved',
      }));
      assert.throws(
        () => context.service.formUpd(context.commandContext, formPlan(context)),
        error => code(error, 'BILLING_SOURCE_BLOCKED_MAPPING'),
      );
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_upds').get().count, 0);
    } finally {
      context.close();
    }
  });
  await t.test('line and snapshot sums reconcile', () => {
    const { context } = setupClosed();
    try {
      assert.throws(
        () => context.service.formUpd(context.commandContext, formPlan(context, {
          netMinor: 90_000,
          vatMinor: 20_000,
          grossMinor: 110_000,
        })),
        error => code(error, 'BILLING_SOURCE_SNAPSHOT_RECONCILIATION'),
      );
    } finally {
      context.close();
    }
  });
  await t.test('overlap is structural', () => {
    const { context, source } = setupClosed();
    try {
      const plan = formPlan(context);
      plan.coverage.slices = [
        { ...plan.coverage.slices[0], sliceEndDateExclusive: '2026-08-20', allocatedNetMinor: 50_000, allocatedVatMinor: 10_000, allocatedGrossMinor: 60_000 },
        { ...plan.coverage.slices[0], sliceStartDate: '2026-08-15', allocatedNetMinor: 50_000, allocatedVatMinor: 10_000, allocatedGrossMinor: 60_000 },
      ];
      assert.equal(source.period.id, plan.coverage.slices[0].periodId);
      assert.throws(
        () => context.service.formUpd(context.commandContext, plan),
        error => code(error, 'BILLING_SOURCE_COVERAGE_OVERLAP'),
      );
    } finally {
      context.close();
    }
  });
});

test('conduct is an explicit append-only event independent of sent, signed, or scan metadata', () => {
  const { context } = setupClosed();
  try {
    context.service.formUpd(context.commandContext, formPlan(context));
    const beforeLines = context.db.prepare('SELECT * FROM billing_source_upd_line_versions ORDER BY id').all();
    const command = conductPlan(context);
    const conducted = context.service.conductUpd(context.commandContext, command);
    assert.equal(conducted.version, 3);
    const versions = context.db.prepare('SELECT * FROM billing_source_upd_versions ORDER BY version').all();
    assert.deepEqual(versions.map(row => row.state), ['draft', 'formed', 'conducted']);
    assert.equal(versions[2].conductedEvidenceRef, 'accounting-conduct-event-1');
    assert.equal(versions[2].formedVersionId, versions[1].id);
    assert.deepEqual(context.db.prepare('SELECT * FROM billing_source_upd_line_versions ORDER BY id').all(), beforeLines);
    const before = tableCounts(context.db);
    assert.equal(context.service.conductUpd(context.commandContext, command).replayed, true);
    assert.deepEqual(tableCounts(context.db), before);
  } finally {
    context.close();
  }
});

test('UPD cancellation and replacement append lineage without deleting originals or creating canonical effects', async t => {
  await t.test('cancel', () => {
    const { context } = setupClosed();
    try {
      context.service.formUpd(context.commandContext, formPlan(context));
      context.service.conductUpd(context.commandContext, conductPlan(context));
      const upd = context.db.prepare('SELECT * FROM billing_source_upds').get();
      const command = {
        operationType: 'correct_upd',
        idempotencyKey: 'cancel-upd-1',
        updId: upd.id,
        expectedUpdVersion: 3,
        action: 'cancel',
        reasonCode: 'ACCOUNTING_CANCEL',
        reasonText: 'Explicit cancellation evidence',
        sourceEventId: 'cancel-event-1',
        sourceEventVersion: 1,
        sourceHash: hash('cancel-event-1'),
      };
      const result = context.service.correctUpd(context.commandContext, command);
      assert.equal(result.version, 4);
      assert.deepEqual(
        context.db.prepare('SELECT state FROM billing_source_upd_versions ORDER BY version').all().map(row => row.state),
        ['draft', 'formed', 'conducted', 'cancelled'],
      );
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_upds').get().count, 1);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_sets').get().count, 1);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_slices').get().count, 1);
      const cancellation = context.db.prepare('SELECT * FROM billing_source_coverage_supersessions').get();
      assert.equal(cancellation.action, 'cancelled');
      assert.equal(cancellation.replacementCoverageSetId, null);
      const reader = createBillingSourceAuthorityReadRepository(context.db);
      const scope = createBillingSourceInspectionScope({ companyId: 'company-a', branchIds: ['branch-a-1'] });
      assert.deepEqual(reader.listActiveValidatedCoverage(scope), []);

      context.service.formUpd(context.commandContext, formPlan(context, {
        idempotencyKey: 'form-upd-after-cancel',
        sourceDocumentRef: 'upd-source-after-cancel',
        sourceLineRef: 'upd-line-source-after-cancel',
      }));
      assert.equal(reader.listActiveValidatedCoverage(scope).length, 1);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_sets').get().count, 2);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_slices').get().count, 2);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivables').get().count, 0);
      const beforeReplay = tableCounts(context.db);
      const replay = context.service.correctUpd(context.commandContext, command);
      assert.equal(replay.replayed, true);
      assert.equal(replay.operationId, result.operationId);
      assert.deepEqual(tableCounts(context.db), beforeReplay);
    } finally {
      context.close();
    }
  });
  await t.test('replace', () => {
    const { context } = setupClosed();
    try {
      context.service.formUpd(context.commandContext, formPlan(context));
      context.service.conductUpd(context.commandContext, conductPlan(context));
      const upd = context.db.prepare('SELECT * FROM billing_source_upds').get();
      const line = context.db.prepare('SELECT * FROM billing_source_upd_lines').get();
      const originalCoverage = context.db.prepare('SELECT * FROM billing_source_coverage_sets').get();
      const replacementCoverage = {
        ...formPlan(context).coverage,
        supersedesCoverageSetIds: [originalCoverage.id],
      };
      const result = context.service.correctUpd(context.commandContext, {
        operationType: 'correct_upd',
        idempotencyKey: 'replace-upd-1',
        updId: upd.id,
        expectedUpdVersion: 3,
        action: 'replace',
        reasonCode: 'ACCOUNTING_REPLACE',
        reasonText: 'Explicit replacement evidence',
        sourceEventId: 'replace-event-1',
        sourceEventVersion: 1,
        sourceHash: hash('replace-event-1'),
        lines: [{
          id: line.id,
          sourceLineRef: line.sourceLineRef,
          sourceLineIdentityKind: line.sourceLineIdentityKind,
          displayPosition: 2,
          description: 'Corrected display metadata',
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
          sourceVersion: 2,
          sourceHash: hash('corrected-line-v2'),
        }],
        coverage: replacementCoverage,
      });
      assert.equal(result.version, 6);
      assert.deepEqual(
        context.db.prepare('SELECT state FROM billing_source_upd_versions ORDER BY version').all().map(row => row.state),
        ['draft', 'formed', 'conducted', 'corrected', 'draft', 'formed'],
      );
      const lineVersions = context.db.prepare('SELECT * FROM billing_source_upd_line_versions ORDER BY version').all();
      assert.deepEqual(lineVersions.map(row => row.version), [1, 2]);
      assert.equal(lineVersions[1].supersedesLineVersionId, lineVersions[0].id);
      const coverageSets = context.db.prepare('SELECT * FROM billing_source_coverage_sets ORDER BY createdAt, id').all();
      assert.equal(coverageSets.length, 2);
      const lifecycle = context.db.prepare('SELECT * FROM billing_source_coverage_supersessions').get();
      assert.equal(lifecycle.originalCoverageSetId, coverageSets[0].id);
      assert.equal(lifecycle.replacementCoverageSetId, coverageSets[1].id);
      assert.equal(lifecycle.action, 'corrected');
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_slices').get().count, 2);
      const reader = createBillingSourceAuthorityReadRepository(context.db);
      const scope = createBillingSourceInspectionScope({ companyId: 'company-a', branchIds: ['branch-a-1'] });
      assert.deepEqual(reader.listActiveValidatedCoverage(scope).map(row => row.id), [coverageSets[1].id]);
      assert.equal(reader.inspectCoverageSet(scope, coverageSets[0].id).lifecycleSuccessor.id, lifecycle.id);
      assert.equal(reader.inspectCoverageSet(scope, coverageSets[1].id).lifecyclePredecessors[0].id, lifecycle.id);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivables').get().count, 0);
    } finally {
      context.close();
    }
  });
});

test('coverage replacement requires the exact active validated predecessor and rejects inactive or blocked sets', async t => {
  await t.test('missing predecessor and already superseded predecessor leave no partial correction rows', () => {
    const { context } = setupClosed();
    try {
      context.service.formUpd(context.commandContext, formPlan(context));
      context.service.conductUpd(context.commandContext, conductPlan(context));
      const original = context.db.prepare('SELECT * FROM billing_source_coverage_sets').get();
      const beforeMissing = tableCounts(context.db);
      assert.throws(
        () => context.service.correctUpd(context.commandContext, replacementCommand(context, {
          idempotencyKey: 'replace-missing-predecessor',
          sourceEventId: 'replace-missing-predecessor-event',
        })),
        error => code(error, 'BILLING_SOURCE_COVERAGE_PREDECESSOR_REQUIRED'),
      );
      assert.deepEqual(tableCounts(context.db), beforeMissing);

      context.service.correctUpd(context.commandContext, replacementCommand(context, {
        idempotencyKey: 'replace-exact-predecessor',
        sourceEventId: 'replace-exact-predecessor-event',
        supersedesCoverageSetIds: [original.id],
      }));
      const beforeInactive = tableCounts(context.db);
      assert.throws(
        () => context.service.correctUpd(context.commandContext, replacementCommand(context, {
          idempotencyKey: 'replace-inactive-predecessor',
          sourceEventId: 'replace-inactive-predecessor-event',
          supersedesCoverageSetIds: [original.id],
        })),
        error => code(error, 'BILLING_SOURCE_COVERAGE_PREDECESSOR_INACTIVE'),
      );
      assert.deepEqual(tableCounts(context.db), beforeInactive);
    } finally {
      context.close();
    }
  });

  await t.test('blocked set neither deactivates validated coverage nor bypasses global overlap', () => {
    const { context } = setupClosed();
    try {
      context.service.formUpd(context.commandContext, formPlan(context, { withoutCoverage: true }));
      context.service.conductUpd(context.commandContext, conductPlan(context));
      const upd = context.db.prepare('SELECT * FROM billing_source_upds').get();
      const formed = context.db.prepare("SELECT * FROM billing_source_upd_versions WHERE state = 'formed'").get();
      const record = (idempotencyKey, coverage, sourceEventId) => context.service.recordUpdCoverage(context.commandContext, {
        operationType: 'record_upd_coverage',
        idempotencyKey,
        updId: upd.id,
        formedUpdVersionId: formed.id,
        expectedUpdVersion: 3,
        coverage,
        reasonCode: 'COVERAGE_EVIDENCE',
        reasonText: 'Explicit coverage evidence',
        sourceEventId,
        sourceEventVersion: 1,
        sourceHash: hash(sourceEventId),
      });
      record('record-validated-before-blocked', formPlan(context, { expectedCoverageVersion: 0 }).coverage, 'validated-before-blocked');
      record('record-blocked-after-validated', formPlan(context, {
        expectedCoverageVersion: 1,
        coverageStatus: 'blocked',
        coverageBlockerReasonCodes: ['MAPPING_UNRESOLVED'],
      }).coverage, 'blocked-after-validated');
      const coverageSets = context.db.prepare('SELECT * FROM billing_source_coverage_sets ORDER BY version').all();
      const validated = coverageSets[0];
      const blocked = coverageSets[1];
      const reader = createBillingSourceAuthorityReadRepository(context.db);
      const scope = createBillingSourceInspectionScope({ companyId: 'company-a', branchIds: ['branch-a-1'] });
      assert.deepEqual(reader.listActiveValidatedCoverage(scope).map(row => row.id), [validated.id]);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_supersessions').get().count, 0);

      const beforeBlockedReplacement = tableCounts(context.db);
      assert.throws(
        () => context.service.correctUpd(context.commandContext, replacementCommand(context, {
          idempotencyKey: 'replace-with-blocked-predecessor',
          sourceEventId: 'replace-with-blocked-predecessor-event',
          supersedesCoverageSetIds: [blocked.id],
        })),
        error => code(error, 'BILLING_SOURCE_COVERAGE_PREDECESSOR_INVALID'),
      );
      assert.deepEqual(tableCounts(context.db), beforeBlockedReplacement);

      const beforeOverlap = tableCounts(context.db);
      assert.throws(
        () => context.service.formUpd(context.commandContext, formPlan(context, {
          idempotencyKey: 'second-upd-after-blocked',
          sourceDocumentRef: 'second-upd-after-blocked',
          sourceLineRef: 'second-upd-line-after-blocked',
        })),
        error => code(error, 'BILLING_SOURCE_COVERAGE_OVERLAP'),
      );
      assert.deepEqual(tableCounts(context.db), beforeOverlap);
    } finally {
      context.close();
    }
  });
});

test('coverage lifecycle table rejects direct mutation, duplicate successor, scope drift, and replacement mismatch', () => {
  const { context } = setupClosed();
  try {
    context.service.formUpd(context.commandContext, formPlan(context));
    context.service.conductUpd(context.commandContext, conductPlan(context));
    const original = context.db.prepare('SELECT * FROM billing_source_coverage_sets').get();
    context.service.correctUpd(context.commandContext, replacementCommand(context, {
      idempotencyKey: 'replace-for-direct-lifecycle-guards',
      sourceEventId: 'replace-for-direct-lifecycle-guards-event',
      supersedesCoverageSetIds: [original.id],
    }));
    const relation = context.db.prepare('SELECT * FROM billing_source_coverage_supersessions').get();
    assert.throws(
      () => context.db.prepare('UPDATE billing_source_coverage_supersessions SET reasonText = ? WHERE id = ?').run('mutated', relation.id),
      /immutable|append-only/,
    );
    assert.throws(
      () => context.db.prepare('DELETE FROM billing_source_coverage_supersessions WHERE id = ?').run(relation.id),
      /immutable|append-only/,
    );
    const copy = (id, companyId, branchId, replacementCoverageSetId = relation.replacementCoverageSetId) => context.db.prepare(`
      INSERT INTO billing_source_coverage_supersessions (
        id, companyId, branchId, originalCoverageSetId, replacementCoverageSetId,
        action, reasonCode, reasonText, operationId, actorPrincipalId,
        actorMembershipId, actorMembershipVersion, capabilityCatalogVersion,
        capabilityKey, sourceEventId, sourceEventVersion, sourceHash,
        schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @originalCoverageSetId, @replacementCoverageSetId,
        @action, @reasonCode, @reasonText, @operationId, @actorPrincipalId,
        @actorMembershipId, @actorMembershipVersion, @capabilityCatalogVersion,
        @capabilityKey, @sourceEventId, @sourceEventVersion, @sourceHash,
        @schemaVersion, @createdAt
      )
    `).run({ ...relation, id, companyId, branchId, replacementCoverageSetId });
    assert.throws(() => copy('duplicate-successor', relation.companyId, relation.branchId), /supersession invalid|UNIQUE constraint failed/);
    assert.throws(() => copy('cross-company', 'company-b', relation.branchId), /supersession invalid|FOREIGN KEY constraint failed/);
    assert.throws(() => copy('cross-branch', relation.companyId, 'branch-a-2'), /supersession invalid|FOREIGN KEY constraint failed/);
    assert.throws(
      () => copy('replacement-mismatch', relation.companyId, relation.branchId, relation.originalCoverageSetId),
      /supersession invalid|CHECK constraint failed|replacement coverage set must differ/i,
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_coverage_supersessions').get().count, 1);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.close();
  }
});

test('capabilities are operation-specific and legacy Administrator display role grants nothing', async t => {
  for (const [capabilities, action, expectedCapability, expectedOperationCount] of [
    [[], context => {
      insertActivationBoundary(context);
      return context.service.closeBillingPeriod(context.commandContext, closePlan());
    }, 'billing.period.close', 0],
    [['billing.period.close'], context => {
      insertActivationBoundary(context);
      context.service.closeBillingPeriod(context.commandContext, closePlan());
      const source = sourceRows(context);
      return context.service.reopenBillingPeriod(context.commandContext, {
        operationType: 'reopen_billing_period', idempotencyKey: 'no-reopen', periodId: source.period.id,
        expectedPeriodVersion: 1, reasonCode: 'TEST', reasonText: 'Test',
        sourceEventId: 'reopen', sourceEventVersion: 1, sourceHash: hash('reopen'),
      });
    }, 'billing.period.reopen', 1],
    [['billing.period.close'], context => {
      insertActivationBoundary(context);
      context.service.closeBillingPeriod(context.commandContext, closePlan());
      return context.service.formUpd(context.commandContext, formPlan(context));
    }, 'upd.form', 1],
    [['billing.period.close', 'upd.form'], context => {
      insertActivationBoundary(context);
      context.service.closeBillingPeriod(context.commandContext, closePlan());
      context.service.formUpd(context.commandContext, formPlan(context));
      return context.service.conductUpd(context.commandContext, conductPlan(context));
    }, 'upd.conduct', 2],
    [['billing.period.close', 'upd.form', 'upd.conduct'], context => {
      insertActivationBoundary(context);
      context.service.closeBillingPeriod(context.commandContext, closePlan());
      context.service.formUpd(context.commandContext, formPlan(context));
      context.service.conductUpd(context.commandContext, conductPlan(context));
      const upd = context.db.prepare('SELECT id FROM billing_source_upds').get();
      return context.service.correctUpd(context.commandContext, {
        operationType: 'correct_upd',
        idempotencyKey: 'no-correct',
        updId: upd.id,
        expectedUpdVersion: 3,
        action: 'cancel',
        reasonCode: 'TEST',
        reasonText: 'Test capability isolation',
        sourceEventId: 'correct-capability-event',
        sourceEventVersion: 1,
        sourceHash: hash('correct-capability-event'),
      });
    }, 'upd.correct', 3],
  ]) {
    await t.test(expectedCapability, () => {
      const context = createBillingSourceContext({ capabilities });
      try {
        assert.throws(() => action(context), /Access is unavailable/);
        assert.equal(
          context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_operations').get().count,
          expectedOperationCount,
        );
      } finally {
        context.close();
      }
    });
  }
});

test('transaction-time user or membership drift fails closed with zero source writes', async t => {
  await t.test('inactive user', () => {
    const context = createBillingSourceContext();
    try {
      insertActivationBoundary(context);
      context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run(JSON.stringify([
        { id: 'U-billing', status: 'Отключен', role: 'Администратор' },
      ]));
      assert.throws(() => context.service.closeBillingPeriod(context.commandContext, closePlan()), /Principal is unavailable|Authorization scope is unavailable/);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_operations').get().count, 0);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_rental_lines').get().count, 0);
    } finally {
      context.close();
    }
  });
  await t.test('stale membership', () => {
    const context = createBillingSourceContext();
    try {
      insertActivationBoundary(context);
      context.db.exec('DROP TRIGGER trg_company_memberships_version');
      context.db.prepare("UPDATE company_memberships SET version = version + 1 WHERE id = 'membership-billing'").run();
      assert.throws(() => context.service.closeBillingPeriod(context.commandContext, closePlan()), /Authorization scope is unavailable/);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_operations').get().count, 0);
    } finally {
      context.close();
    }
  });
});

test('direct repository calls reject unbranded context and unbranded command plan', () => {
  const context = createBillingSourceContext();
  try {
    insertActivationBoundary(context);
    const repository = createBillingSourceAuthorityRepository(context.db);
    const brandedPlan = materializeBillingSourceCommandPlan(closePlan());
    assert.throws(
      () => repository.closeBillingPeriod({ ...context.commandContext }, brandedPlan),
      error => code(error, 'BILLING_SOURCE_COMMAND_CONTEXT_REJECTED'),
    );
    assert.throws(
      () => repository.closeBillingPeriod(context.commandContext, closePlan()),
      error => code(error, 'BILLING_SOURCE_PLAN_CONTEXT_REJECTED'),
    );
  } finally {
    context.close();
  }
});

test('SQLite audit failure rolls back complete close mutation, operation, and audit atomically', () => {
  const context = createBillingSourceContext();
  try {
    insertActivationBoundary(context);
    const before = tableCounts(context.db);
    context.db.exec(`
      CREATE TEMP TRIGGER fail_billing_source_audit_insert
      BEFORE INSERT ON billing_source_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'forced billing source audit failure');
      END;
    `);
    assert.throws(
      () => context.service.closeBillingPeriod(context.commandContext, closePlan()),
      /forced billing source audit failure/,
    );
    assert.deepEqual(tableCounts(context.db), before);
    assert.equal(context.db.inTransaction, false);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.close();
  }
});
