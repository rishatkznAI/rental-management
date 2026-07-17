import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  closePlan,
  conductPlan,
  createBillingSourceContext,
  formPlan,
  hash,
  insertActivationBoundary,
} from './billing-source-authority-fixtures.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  BILLING_SOURCE_AUTHORITY_TABLES,
} = require('../server/lib/billing-source-authority-schema.js');
const {
  BillingSourceAuthorityError,
  createBillingSourceCommandContext,
} = require('../server/lib/billing-source-authority-domain.js');
const {
  createBillingSourceAuthorityReadRepository,
  createBillingSourceInspectionScope,
} = require('../server/lib/billing-source-authority-read-repository.js');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function counts(db) {
  return Object.fromEntries(BILLING_SOURCE_AUTHORITY_TABLES.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

function code(error, expected) {
  return error instanceof BillingSourceAuthorityError && error.code === expected;
}

test('PR6 production runtime imports schema initialization only and adds no HTTP or legacy route wiring', () => {
  const dbSource = read('server/db.js');
  const serverSource = read('server/server.js');
  const startupSource = read('server/lib/startup.js');
  const legacyRoutes = [
    'server/routes/rentals.js',
    'server/routes/documents.js',
    'server/routes/finance.js',
    'server/routes/crud.js',
  ].map(read).join('\n');
  assert.match(dbSource, /ensureBillingSourceAuthoritySchema\(db\)/);
  assert.match(dbSource, /billing-source-authority-schema/);
  assert.doesNotMatch(dbSource, /billing-source-authority-(?:service|repository|read-repository)/);
  assert.doesNotMatch(serverSource, /billing-source-authority/);
  assert.doesNotMatch(startupSource, /billing-source-authority/);
  assert.doesNotMatch(legacyRoutes, /billing-source-authority/);
  assert.equal(fs.existsSync(path.join(root, 'server/routes/billing-source-authority.js')), false);
});

test('PR6 modules contain no canonical financial DML, posting, eligibility event, forecast, backfill, or legacy source write', () => {
  const sourceFiles = [
    'server/lib/billing-source-authority-schema.js',
    'server/lib/billing-source-authority-domain.js',
    'server/lib/billing-source-authority-repository.js',
    'server/lib/billing-source-authority-service.js',
    'server/lib/billing-source-authority-read-repository.js',
  ];
  const source = sourceFiles.map(read).join('\n');
  assert.doesNotMatch(source, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:canonical_receivables|canonical_payments|canonical_payment_allocations|canonical_receivable_adjustments|canonical_approval_requests|financial_audit_events)/i);
  assert.doesNotMatch(source, /CanonicalReceivablePosted|ActualReceivableEligibleV1|canonical posting adapter/i);
  assert.doesNotMatch(source, /canonical-receivables-settlement-repository/);
  assert.doesNotMatch(source, /CREATE TABLE\s+[^\n]*(?:forecast|planning)/i);
  assert.doesNotMatch(source, /backfill|historical import|dual.?write|shadow.?read/i);
  assert.doesNotMatch(source, /(?:INSERT\s+INTO|UPDATE)\s+app_data/i);
  assert.doesNotMatch(source, /parseFloat|Math\.round/);
  assert.doesNotMatch(source, /\b(?:setInterval|setTimeout|purge|ttl|cleanup)\b/i);
});

test('production resolver stays unconditional null and canonical read feature semantics remain unchanged', () => {
  const adapter = read('server/lib/canonical-receivables-scope-adapter.js');
  const featureFlags = read('server/lib/feature-flags.js');
  const server = read('server/server.js');
  assert.match(adapter, /function resolveCanonicalReceivablesTrustedScope\(\) \{\s*return null;\s*\}/);
  assert.match(featureFlags, /CANONICAL_RECEIVABLES_READ_API_ENABLED/);
  assert.match(server, /CANONICAL_RECEIVABLES_READ_API_ENABLED \? ensureDb\(\) : null/);
  assert.doesNotMatch(adapter, /billing-source-authority|platform-authorization/);
});

test('Finance, Company Health/Risks, feature flags, deployment, and frontend have no PR6 change', () => {
  const unchanged = execFileSync('git', [
    'diff', '--name-only', 'origin/main', '--',
    'src', 'server/routes/finance.js', 'server/lib/finance-core.js',
    'server/lib/feature-flags.js', 'server/server.js', 'server/lib/startup.js',
  ], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(unchanged, '');
});

test('pre-transaction inert-input rejection executes no getter and changes no source table', () => {
  const context = createBillingSourceContext();
  try {
    insertActivationBoundary(context);
    const before = counts(context.db);
    let getterCalls = 0;
    const command = closePlan();
    Object.defineProperty(command.snapshot, 'unexpected', {
      enumerable: true,
      get() { getterCalls += 1; return 1; },
    });
    assert.throws(
      () => context.service.closeBillingPeriod(context.commandContext, command),
      error => code(error, 'BILLING_SOURCE_COMMAND_NOT_INERT'),
    );
    assert.equal(getterCalls, 0);
    assert.deepEqual(counts(context.db), before);
    assert.equal(context.db.inTransaction, false);
  } finally {
    context.close();
  }
});

test('SQLite-native close fault injection rolls back each authority write stage', async t => {
  for (const table of [
    'billing_source_rental_lines',
    'billing_source_effective_terms',
    'billing_source_periods',
    'billing_source_period_versions',
    'billing_source_snapshots',
    'billing_source_snapshot_evidence',
    'billing_source_operations',
    'billing_source_audit_events',
  ]) {
    await t.test(table, () => {
      const context = createBillingSourceContext();
      try {
        insertActivationBoundary(context);
        const before = counts(context.db);
        context.db.exec(`
          CREATE TEMP TRIGGER fail_${table}
          BEFORE INSERT ON ${table}
          BEGIN
            SELECT RAISE(ABORT, 'forced ${table} failure');
          END;
        `);
        assert.throws(
          () => context.service.closeBillingPeriod(context.commandContext, closePlan()),
          new RegExp(`forced ${table} failure`),
        );
        assert.deepEqual(counts(context.db), before);
        assert.equal(context.db.inTransaction, false);
        assert.deepEqual(context.db.pragma('foreign_key_check'), []);
      } finally {
        context.close();
      }
    });
  }
});

test('transaction-owned persisted evidence hash mismatch rolls back the complete close', () => {
  const context = createBillingSourceContext();
  try {
    insertActivationBoundary(context);
    const before = counts(context.db);
    context.db.exec(`
      CREATE TEMP TRIGGER inject_persisted_evidence_mismatch
      AFTER INSERT ON billing_source_snapshot_evidence
      WHEN NEW.evidenceType <> 'other_explicit'
      BEGIN
        INSERT INTO billing_source_snapshot_evidence (
          id, companyId, branchId, snapshotId, evidenceType, sourceSystem,
          sourceId, sourceVersion, sourceEventId, sourceEventVersion,
          coveredStartDate, coveredEndDateExclusive, authorityStatus,
          authorityPolicyRef, evidenceHash, schemaVersion, createdAt
        ) VALUES (
          'injected-evidence-row', NEW.companyId, NEW.branchId, NEW.snapshotId,
          'other_explicit', 'fault_injection', 'injected-source', 1,
          'injected-event', 1, NEW.coveredStartDate, NEW.coveredEndDateExclusive,
          'unresolved', NULL, '${hash('injected-evidence-content')}', NEW.schemaVersion, NEW.createdAt
        );
      END;
    `);
    assert.throws(
      () => context.service.closeBillingPeriod(context.commandContext, closePlan()),
      error => code(error, 'BILLING_SOURCE_PERSISTED_EVIDENCE_HASH_MISMATCH'),
    );
    assert.deepEqual(counts(context.db), before);
    assert.equal(context.db.inTransaction, false);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.close();
  }
});

test('SQLite-native form fault injection rolls back UPD, line, coverage, operation, and audit stages', async t => {
  for (const table of [
    'billing_source_upds',
    'billing_source_upd_versions',
    'billing_source_upd_lines',
    'billing_source_upd_line_versions',
    'billing_source_coverage_sets',
    'billing_source_coverage_slices',
    'billing_source_operations',
    'billing_source_audit_events',
  ]) {
    await t.test(table, () => {
      const context = createBillingSourceContext();
      try {
        insertActivationBoundary(context);
        context.service.closeBillingPeriod(context.commandContext, closePlan());
        const before = counts(context.db);
        context.db.exec(`
          CREATE TEMP TRIGGER fail_form_${table}
          BEFORE INSERT ON ${table}
          BEGIN
            SELECT RAISE(ABORT, 'forced form ${table} failure');
          END;
        `);
        assert.throws(
          () => context.service.formUpd(context.commandContext, formPlan(context)),
          new RegExp(`forced form ${table} failure`),
        );
        assert.deepEqual(counts(context.db), before);
        assert.equal(context.db.inTransaction, false);
        assert.deepEqual(context.db.pragma('foreign_key_check'), []);
      } finally {
        context.close();
      }
    });
  }
});

test('coverage lifecycle insertion failure rolls back complete cancellation and replacement transactions', async t => {
  await t.test('cancel', () => {
    const context = createBillingSourceContext();
    try {
      insertActivationBoundary(context);
      context.service.closeBillingPeriod(context.commandContext, closePlan());
      context.service.formUpd(context.commandContext, formPlan(context));
      context.service.conductUpd(context.commandContext, conductPlan(context));
      const upd = context.db.prepare('SELECT id FROM billing_source_upds').get();
      const before = counts(context.db);
      context.db.exec(`
        CREATE TEMP TRIGGER fail_cancel_coverage_lifecycle
        BEFORE INSERT ON billing_source_coverage_supersessions
        BEGIN
          SELECT RAISE(ABORT, 'forced cancellation lifecycle failure');
        END;
      `);
      assert.throws(() => context.service.correctUpd(context.commandContext, {
        operationType: 'correct_upd',
        idempotencyKey: 'cancel-lifecycle-fault',
        updId: upd.id,
        expectedUpdVersion: 3,
        action: 'cancel',
        reasonCode: 'CANCEL_FAULT',
        reasonText: 'Cancellation lifecycle fault injection',
        sourceEventId: 'cancel-lifecycle-fault-event',
        sourceEventVersion: 1,
        sourceHash: hash('cancel-lifecycle-fault-event'),
      }), /forced cancellation lifecycle failure/);
      assert.deepEqual(counts(context.db), before);
      assert.equal(context.db.prepare('SELECT state FROM billing_source_upd_versions ORDER BY version DESC LIMIT 1').get().state, 'conducted');
      assert.equal(context.db.inTransaction, false);
    } finally {
      context.close();
    }
  });

  await t.test('replace', () => {
    const context = createBillingSourceContext();
    try {
      insertActivationBoundary(context);
      context.service.closeBillingPeriod(context.commandContext, closePlan());
      context.service.formUpd(context.commandContext, formPlan(context));
      context.service.conductUpd(context.commandContext, conductPlan(context));
      const upd = context.db.prepare('SELECT id FROM billing_source_upds').get();
      const line = context.db.prepare('SELECT * FROM billing_source_upd_lines').get();
      const predecessor = context.db.prepare('SELECT id FROM billing_source_coverage_sets').get();
      const before = counts(context.db);
      context.db.exec(`
        CREATE TEMP TRIGGER fail_replacement_coverage_lifecycle
        BEFORE INSERT ON billing_source_coverage_supersessions
        BEGIN
          SELECT RAISE(ABORT, 'forced replacement lifecycle failure');
        END;
      `);
      assert.throws(() => context.service.correctUpd(context.commandContext, {
        operationType: 'correct_upd',
        idempotencyKey: 'replace-lifecycle-fault',
        updId: upd.id,
        expectedUpdVersion: 3,
        action: 'replace',
        reasonCode: 'REPLACE_FAULT',
        reasonText: 'Replacement lifecycle fault injection',
        sourceEventId: 'replace-lifecycle-fault-event',
        sourceEventVersion: 1,
        sourceHash: hash('replace-lifecycle-fault-event'),
        lines: [{
          id: line.id,
          sourceLineRef: line.sourceLineRef,
          sourceLineIdentityKind: line.sourceLineIdentityKind,
          displayPosition: 2,
          description: 'Replacement lifecycle fault line',
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
          sourceHash: hash('replace-lifecycle-fault-line'),
        }],
        coverage: {
          ...formPlan(context).coverage,
          supersedesCoverageSetIds: [predecessor.id],
        },
      }), /forced replacement lifecycle failure/);
      assert.deepEqual(counts(context.db), before);
      assert.equal(context.db.prepare('SELECT state FROM billing_source_upd_versions ORDER BY version DESC LIMIT 1').get().state, 'conducted');
      assert.equal(context.db.inTransaction, false);
      assert.deepEqual(context.db.pragma('foreign_key_check'), []);
    } finally {
      context.close();
    }
  });
});

test('internal inspection repository is branded, scoped, bounded, deterministic, and non-disclosing', () => {
  const context = createBillingSourceContext({ companyWideBranchAuthority: true });
  try {
    insertActivationBoundary(context);
    context.service.closeBillingPeriod(context.commandContext, closePlan());
    context.service.formUpd(context.commandContext, formPlan(context));
    const reader = createBillingSourceAuthorityReadRepository(context.db);
    const scope = createBillingSourceInspectionScope({
      companyId: 'company-a',
      branchIds: ['branch-a-1'],
    });
    const line = context.db.prepare('SELECT id FROM billing_source_rental_lines').get();
    const period = context.db.prepare('SELECT id FROM billing_source_periods').get();
    const snapshot = context.db.prepare('SELECT id FROM billing_source_snapshots').get();
    const upd = context.db.prepare('SELECT id FROM billing_source_upds').get();
    const coverage = context.db.prepare('SELECT id FROM billing_source_coverage_sets').get();
    assert.equal(reader.inspectRentalLine(scope, line.id).rentalLine.id, line.id);
    assert.deepEqual(reader.inspectTermsVersions(scope, line.id).map(row => row.version), [1]);
    assert.deepEqual(reader.inspectPeriod(scope, period.id).versions.map(row => row.version), [1]);
    assert.equal(reader.inspectSnapshot(scope, snapshot.id).evidence.length, 1);
    assert.deepEqual(reader.inspectUpd(scope, upd.id).versions.map(row => row.version), [1, 2]);
    assert.equal(reader.inspectUpdLines(scope, upd.id)[0].versions.length, 1);
    assert.equal(reader.inspectCoverageSet(scope, coverage.id).slices.length, 1);
    assert.equal(reader.inspectAuditHistory(scope, 'upd', upd.id).length, 1);
    assert.throws(
      () => reader.inspectUpd({ companyId: 'company-a', branchIds: ['branch-a-1'] }, upd.id),
      error => code(error, 'BILLING_SOURCE_INSPECTION_SCOPE_REQUIRED'),
    );
    assert.throws(
      () => reader.inspectAuditHistory(scope, 'upd', upd.id, { limit: 101 }),
      error => code(error, 'BILLING_SOURCE_INSPECTION_LIMIT_INVALID'),
    );
    const otherBranchScope = createBillingSourceInspectionScope({
      companyId: 'company-a',
      branchIds: ['branch-a-2'],
    });
    assert.equal(reader.inspectUpd(otherBranchScope, upd.id), null);
  } finally {
    context.close();
  }
});

test('company-wide authority still materializes concrete branch IDs and requested branch only narrows scope', () => {
  const context = createBillingSourceContext({ companyWideBranchAuthority: true });
  try {
    assert.deepEqual(context.platformScope.allowedBranchIds, ['branch-a-1', 'branch-a-2', 'branch-a-ho']);
    const narrowed = createBillingSourceCommandContext(context.platformScope, {
      branchId: 'branch-a-2',
      correlationId: 'branch-two-correlation',
    });
    assert.equal(narrowed.branchId, 'branch-a-2');
    assert.equal(narrowed.allowedBranchIds.includes('*'), false);
    assert.throws(
      () => createBillingSourceCommandContext(context.platformScope, {
        branchId: '*',
        correlationId: 'wildcard-correlation',
      }),
      error => code(error, 'BILLING_SOURCE_SCOPE_REJECTED'),
    );
  } finally {
    context.close();
  }
});

test('blocked integrity inspection is explicit and performs no eligibility, aging, or forecast calculation', () => {
  const context = createBillingSourceContext();
  try {
    insertActivationBoundary(context);
    context.service.closeBillingPeriod(context.commandContext, closePlan({
      sourceIntegrityStatus: 'blocked',
      blockerReasonCodes: ['VAT_POLICY_UNRESOLVED'],
      policyResolutionStatus: 'unresolved',
      unresolvedReasonCodes: ['VAT_POLICY_UNRESOLVED'],
      evidenceAuthorityStatus: 'unresolved',
    }));
    const reader = createBillingSourceAuthorityReadRepository(context.db);
    const scope = createBillingSourceInspectionScope({ companyId: 'company-a', branchIds: ['branch-a-1'] });
    const blocked = reader.listBlockedSourceIntegrity(scope, { limit: 10 });
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].sourceType, 'snapshot');
    assert.deepEqual(JSON.parse(blocked[0].blockerReasonCodesJson), ['VAT_POLICY_UNRESOLVED']);
    const source = read('server/lib/billing-source-authority-read-repository.js');
    assert.doesNotMatch(source, /app_data|finance-core|canonical_receivables|aging|eligibility|forecast/i);
  } finally {
    context.close();
  }
});

test('generic legacy signed UPD document creates no Billing Source Authority row', () => {
  const context = createBillingSourceContext();
  try {
    context.db.prepare(`
      INSERT INTO app_data (name, json) VALUES ('documents', ?)
    `).run(JSON.stringify([{
      id: 'legacy-document-1',
      type: 'upd',
      status: 'signed',
      signedAt: '2026-07-17T10:00:00.000Z',
      signedScanFileName: 'scan.pdf',
      payload: { lines: [{ description: 'positional row', amount: 100.5 }] },
    }]));
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_upds').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_upd_versions').get().count, 0);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM billing_source_operations').get().count, 0);
  } finally {
    context.close();
  }
});

test('failed overlap and idempotency commands leave no additional operation or audit row', () => {
  const context = createBillingSourceContext();
  try {
    insertActivationBoundary(context);
    context.service.closeBillingPeriod(context.commandContext, closePlan());
    const before = counts(context.db);
    assert.throws(
      () => context.service.closeBillingPeriod(context.commandContext, closePlan({
        grossMinor: 120_001,
        sourceIntegrityStatus: 'blocked',
        blockerReasonCodes: ['MISMATCH'],
      })),
      error => code(error, 'BILLING_SOURCE_IDEMPOTENCY_CONFLICT'),
    );
    assert.deepEqual(counts(context.db), before);
    assert.equal(context.db.inTransaction, false);
  } finally {
    context.close();
  }
});
