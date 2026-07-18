import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  SOURCE_CAPABILITIES,
  closePlan,
  hash,
  sourceRows,
} from './billing-source-authority-fixtures.js';
import {
  createForecastTestContext,
  deterministicForecastPolicy,
  forecastCommand,
} from './forecast-receivables-planning-fixtures.js';

const require = createRequire(import.meta.url);
const {
  createForecastReceivablesPlanningRepository,
} = require('../server/lib/forecast-receivables-planning-repository.js');
const {
  createForecastReceivablesPlanningService,
} = require('../server/lib/forecast-receivables-planning-service.js');

test('successful calculation persists run, input, events, item, operation, and audit atomically', () => {
  const context = createForecastTestContext();
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  assert.equal(result.replayed, false);
  assert.equal(result.status, 'calculated');
  const expectedCounts = {
    forecast_receivable_runs: 1,
    forecast_receivable_input_snapshots: 1,
    forecast_receivable_input_events: 2,
    forecast_receivable_items: 1,
    forecast_receivable_diagnostics: 0,
    forecast_receivable_operations: 1,
    forecast_receivable_audit_events: 1,
  };
  for (const [table, expected] of Object.entries(expectedCounts)) {
    assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, expected, table);
  }
  const operation = context.db.prepare('SELECT * FROM forecast_receivable_operations').get();
  const audit = context.db.prepare('SELECT * FROM forecast_receivable_audit_events').get();
  assert.equal(operation.resultRunId, result.forecastRunId);
  assert.equal(operation.resultHash, result.resultHash);
  assert.equal(operation.capabilityKey, 'forecast.calculate');
  assert.equal(audit.actorPrincipalId, context.forecastCommandContext.principalId);
  assert.equal(audit.operationId, operation.id);
  assert.equal(audit.inputSetHash, result.inputSetHash);
  assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  context.close();
});

test('repository requires branded trusted context and exact forecast.calculate capability', () => {
  const context = createForecastTestContext();
  const unbrandedContext = { ...context.forecastCommandContext };
  assert.throws(
    () => context.forecastService.calculateForecastRun(unbrandedContext, forecastCommand(context)),
    error => error.code === 'FORECAST_COMMAND_CONTEXT_REJECTED',
  );
  context.close();

  const denied = createForecastTestContext({ capabilities: SOURCE_CAPABILITIES });
  assert.throws(
    () => denied.forecastService.calculateForecastRun(
      denied.forecastCommandContext,
      forecastCommand(denied),
    ),
    error => error.code === 'PLATFORM_CAPABILITY_DENIED',
  );
  assert.equal(denied.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 0);
  denied.close();
});

test('client branch may only narrow exact authorized branch scope', () => {
  const context = createForecastTestContext();
  const command = forecastCommand(context);
  command.branchId = 'branch-a-2';
  command.inputSetManifest.coveredBranchId = 'branch-a-2';
  assert.throws(
    () => context.forecastService.calculateForecastRun(context.forecastCommandContext, command),
    error => error.status === 404,
  );
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 0);
  context.close();
});

test('source identities and hashes are re-read from PR6 inside commit', () => {
  for (const mutate of [
    command => { command.inputs[0].sourceHash = hash('drifted-rental-line'); },
    command => { command.inputs[0].effectiveTermsSourceVersion += 1; },
    command => { command.inputs[0].activationBoundarySourceHash = hash('drifted-boundary'); },
    command => { command.inputs[0].clientId = 'cross-client'; },
  ]) {
    const context = createForecastTestContext();
    const command = forecastCommand(context);
    mutate(command);
    assert.throws(
      () => context.forecastService.calculateForecastRun(context.forecastCommandContext, command),
      error => error.code === 'FORECAST_SOURCE_VERSION_DRIFT',
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 0);
    context.close();
  }
});

test('exact idempotent retry returns the same logical run without new history', () => {
  const context = createForecastTestContext();
  const command = forecastCommand(context);
  const first = context.forecastService.calculateForecastRun(context.forecastCommandContext, command);
  const replay = context.forecastService.calculateForecastRun(context.forecastCommandContext, command);
  assert.equal(replay.replayed, true);
  assert.equal(replay.forecastRunId, first.forecastRunId);
  for (const table of [
    'forecast_receivable_runs',
    'forecast_receivable_items',
    'forecast_receivable_operations',
    'forecast_receivable_audit_events',
  ]) assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1, table);
  context.close();
});

test('same idempotency identity with changed command conflicts without writes', () => {
  const context = createForecastTestContext();
  const first = forecastCommand(context);
  context.forecastService.calculateForecastRun(context.forecastCommandContext, first);
  const changed = forecastCommand(context, { correlationId: 'changed-correlation' });
  assert.throws(
    () => context.forecastService.calculateForecastRun(context.forecastCommandContext, changed),
    error => error.code === 'FORECAST_IDEMPOTENCY_CONFLICT',
  );
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 1);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_audit_events').get().count, 1);
  context.close();
});

test('bad expected input hash rolls back the complete calculation', () => {
  const context = createForecastTestContext();
  const command = forecastCommand(context, { expectedInputSetHash: hash('wrong-input-set') });
  assert.throws(
    () => context.forecastService.calculateForecastRun(context.forecastCommandContext, command),
    error => error.code === 'FORECAST_INPUT_SET_HASH_MISMATCH',
  );
  for (const table of [
    'forecast_receivable_runs',
    'forecast_receivable_input_snapshots',
    'forecast_receivable_items',
    'forecast_receivable_operations',
    'forecast_receivable_audit_events',
  ]) assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  context.close();
});

test('replacement requires the exact active run set and appends supersession', () => {
  const context = createForecastTestContext();
  const first = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  assert.throws(
    () => context.forecastService.calculateForecastRun(
      context.forecastCommandContext,
      forecastCommand(context, { idempotencyKey: 'forecast-stale-predecessor' }),
    ),
    error => error.code === 'FORECAST_ACTIVE_RUN_CONFLICT',
  );
  const second = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, {
      idempotencyKey: 'forecast-replacement-2',
      expectedActiveRunIds: [first.forecastRunId],
      reasonCode: 'FORECAST_TERMS_REFRESHED',
    }),
  );
  assert.notEqual(second.forecastRunId, first.forecastRunId);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 2);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_run_supersessions').get().count, 1);
  const current = context.db.prepare(`
    SELECT run.id FROM forecast_receivable_runs run
    WHERE NOT EXISTS (
      SELECT 1 FROM forecast_receivable_run_supersessions lifecycle
      WHERE lifecycle.predecessorRunId = run.id
    )
  `).all();
  assert.deepEqual(current.map(row => row.id), [second.forecastRunId]);
  context.close();
});

test('exact closed PR6 period suppresses monetary coverage without deleting history', () => {
  const context = createForecastTestContext();
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, {
      asOfDate: '2026-08-01',
      candidateStartDate: '2026-08-01',
      candidateEndDateExclusive: '2026-08-31',
    }),
  );
  // The PR6 period is 2026-08-01..2026-09-01, so a 30-day sub-slice is a
  // partial overlap and must fail closed without heuristic trimming.
  assert.equal(result.status, 'insufficient');
  assert.equal(result.itemCount, 0);
  assert.ok(context.db.prepare(`
    SELECT 1 FROM forecast_receivable_diagnostics
    WHERE reasonCode = 'FORECAST_CLOSED_COVERAGE_OVERLAP'
  `).get());
  context.close();
});

test('an exact authoritative closed slice is suppressed as a valid complete zero', () => {
  const context = createForecastTestContext({
    policyRegistry: deterministicForecastPolicy(),
    sourceCloseOverrides: {
      periodStartDate: '2026-09-01',
      periodEndDateExclusive: '2026-10-01',
      termsFrom: '2026-09-01',
    },
  });
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  assert.equal(result.status, 'calculated');
  assert.equal(result.completeness, 'complete');
  assert.equal(result.itemCount, 0);
  assert.equal(result.primaryForecastMinor, 0);
  assert.ok(context.db.prepare(`
    SELECT 1 FROM forecast_receivable_diagnostics
    WHERE reasonCode = 'FORECAST_CLOSED_COVERAGE_SUPPRESSED' AND severity = 'info'
  `).get());
  context.close();
});

test('latest reopened PR6 period is not treated as active closed suppression evidence', () => {
  const context = createForecastTestContext();
  const source = sourceRows(context);
  context.service.reopenBillingPeriod(context.commandContext, {
    operationType: 'reopen_billing_period',
    idempotencyKey: 'forecast-source-reopen-1',
    periodId: source.period.id,
    expectedPeriodVersion: 1,
    reasonCode: 'FORECAST_TEST_REOPEN',
    reasonText: 'Reopened for isolated forecast coverage test.',
    sourceEventId: 'forecast-reopen-event-1',
    sourceEventVersion: 1,
    sourceHash: hash('forecast-reopen-event-1'),
  });
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, {
      asOfDate: '2026-08-01',
      candidateStartDate: '2026-08-01',
      candidateEndDateExclusive: '2026-08-31',
    }),
  );
  assert.equal(result.status, 'calculated');
  assert.equal(result.itemCount, 1);
  context.close();
});

test('stale membership and deactivated branch fail fresh authorization before writes', () => {
  const stale = createForecastTestContext();
  stale.db.prepare(`
    UPDATE company_memberships SET version = version + 1 WHERE id = ?
  `).run(stale.forecastCommandContext.membershipId);
  assert.throws(
    () => stale.forecastService.calculateForecastRun(stale.forecastCommandContext, forecastCommand(stale)),
    error => error.code === 'PLATFORM_SCOPE_STALE',
  );
  assert.equal(stale.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 0);
  stale.close();

  const inactive = createForecastTestContext();
  inactive.db.prepare(`
    UPDATE canonical_branches SET status = 'inactive', version = version + 1
    WHERE companyId = 'company-a' AND id = 'branch-a-1'
  `).run();
  assert.throws(
    () => inactive.forecastService.calculateForecastRun(inactive.forecastCommandContext, forecastCommand(inactive)),
    error => ['PLATFORM_SCOPE_STALE', 'PLATFORM_BRANCH_SCOPE_DENIED'].includes(error.code),
  );
  assert.equal(inactive.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 0);
  inactive.close();
});

test('SQLite-native audit insertion failure rolls back the entire run', () => {
  const context = createForecastTestContext();
  context.db.exec(`
    CREATE TRIGGER forecast_test_fail_audit
    BEFORE INSERT ON forecast_receivable_audit_events
    BEGIN
      SELECT RAISE(ABORT, 'injected forecast audit failure');
    END;
  `);
  assert.throws(
    () => context.forecastService.calculateForecastRun(context.forecastCommandContext, forecastCommand(context)),
    /injected forecast audit failure/,
  );
  for (const table of [
    'forecast_receivable_runs',
    'forecast_receivable_input_snapshots',
    'forecast_receivable_input_events',
    'forecast_receivable_items',
    'forecast_receivable_diagnostics',
    'forecast_receivable_run_supersessions',
    'forecast_receivable_operations',
    'forecast_receivable_audit_events',
  ]) assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  context.close();
});

test('repository cannot be called with a caller-created unbranded prepared plan', () => {
  const context = createForecastTestContext();
  const repository = createForecastReceivablesPlanningRepository(context.db, {
    readUsers: context.readUsers,
  });
  assert.throws(
    () => repository.calculateForecastRun(context.forecastCommandContext, forecastCommand(context)),
    error => error.code === 'FORECAST_PREPARED_PLAN_REJECTED',
  );
  context.close();
});

test('all injected policy callbacks finish before the repository transaction begins', () => {
  const context = createForecastTestContext();
  const transactionStates = [];
  const policyRegistry = deterministicForecastPolicy({
    partition: ({ input }) => {
      transactionStates.push(context.db.inTransaction);
      return {
        policyVersion: 'forecast-coverage-test-v1',
        slices: [{
          coverageStartDate: input.candidateStartDate,
          coverageEndDateExclusive: input.candidateEndDateExclusive,
        }],
      };
    },
    calculate: () => {
      transactionStates.push(context.db.inTransaction);
      return {
        calculationVersion: 'forecast-calculation-test-v1',
        calculationPolicyRef: 'forecast-calculation-policy-test-v1',
        vatPolicyRef: 'forecast-vat-policy-test-v1',
        roundingPolicyRef: 'forecast-rounding-policy-test-v1',
        policyDecisionRef: 'forecast-policy-decision-test-v1',
        minimumTermPolicyRef: 'forecast-minimum-term-policy-test-v1',
        netAmountMinor: 10_000,
        vatAmountMinor: 2_000,
        grossAmountMinor: 12_000,
        normalizedCalculationEvidence: { explicitTestPolicy: true },
      };
    },
    classify: () => {
      transactionStates.push(context.db.inTransaction);
      return {
        confidencePolicyVersion: 'forecast-confidence-test-v1',
        confidence: 'high',
        reasonCodes: ['FORECAST_TEST_INPUT_COMPLETE'],
      };
    },
  });
  const service = createForecastReceivablesPlanningService({
    db: context.db,
    readUsers: context.readUsers,
    policyRegistry,
    repositoryOptions: { nowIso: () => '2026-07-18T06:00:00.000Z' },
  });
  const result = service.calculateForecastRun(
    service.createCommandContext(context.platformScope),
    forecastCommand(context),
  );
  assert.equal(result.status, 'calculated');
  assert.deepEqual(transactionStates, [false, false, false]);
  context.close();
});

test('source drift introduced after planning but before commit fails closed without PR7 rows', () => {
  const context = createForecastTestContext();
  const command = forecastCommand(context);
  const source = sourceRows(context);
  let changed = false;
  const policyRegistry = deterministicForecastPolicy({
    partition: ({ input }) => {
      if (!changed) {
        changed = true;
        context.service.closeBillingPeriod(context.commandContext, closePlan({
          rentalLineId: source.rentalLine.id,
          expectedLatestTermsVersion: 1,
          periodStartDate: '2026-10-01',
          periodEndDateExclusive: '2026-11-01',
          termsFrom: '2026-10-01',
          termsTo: '2026-12-01',
          idempotencyKey: 'forecast-source-drift-close-2',
          sourceEventId: 'forecast-source-drift-close-event-2',
          sourceHash: hash('forecast-source-drift-close-2'),
        }));
      }
      return {
        policyVersion: 'forecast-coverage-test-v1',
        slices: [{
          coverageStartDate: input.candidateStartDate,
          coverageEndDateExclusive: input.candidateEndDateExclusive,
        }],
      };
    },
  });
  const service = createForecastReceivablesPlanningService({
    db: context.db,
    readUsers: context.readUsers,
    policyRegistry,
  });
  assert.throws(
    () => service.calculateForecastRun(service.createCommandContext(context.platformScope), command),
    error => error.code === 'FORECAST_SOURCE_VERSION_DRIFT',
  );
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 0);
  context.close();
});

for (const mutation of ['capability-deny', 'branch-deactivate']) {
  test(`${mutation} after planning but before commit is rejected by fresh authorization`, () => {
    const context = createForecastTestContext();
    let changed = false;
    const policyRegistry = deterministicForecastPolicy({
      partition: ({ input }) => {
        if (!changed) {
          changed = true;
          if (mutation === 'capability-deny') {
            context.db.prepare(`
              INSERT INTO membership_capability_assignments (
                id, membershipId, companyId, catalogVersion, capabilityKey, effect,
                status, version, grantedAt, grantedBy, reason
              ) VALUES (?, ?, ?, ?, 'forecast.calculate', 'deny', 'active', 1, ?, ?, ?)
            `).run(
              'forecast-test-capability-deny',
              context.forecastCommandContext.membershipId,
              context.forecastCommandContext.companyId,
              context.forecastCommandContext.capabilityCatalogVersion,
              '2026-07-18T05:59:59.000Z',
              'U-billing',
              'forecast-before-commit-revocation-test',
            );
          } else {
            context.db.prepare(`
              UPDATE canonical_branches
              SET status = 'inactive', version = version + 1
              WHERE companyId = ? AND id = ?
            `).run(context.forecastCommandContext.companyId, 'branch-a-1');
          }
        }
        return {
          policyVersion: 'forecast-coverage-test-v1',
          slices: [{
            coverageStartDate: input.candidateStartDate,
            coverageEndDateExclusive: input.candidateEndDateExclusive,
          }],
        };
      },
    });
    const service = createForecastReceivablesPlanningService({
      db: context.db,
      readUsers: context.readUsers,
      policyRegistry,
    });
    assert.throws(
      () => service.calculateForecastRun(
        service.createCommandContext(context.platformScope),
        forecastCommand(context),
      ),
      error => [
        'PLATFORM_SCOPE_STALE',
        'PLATFORM_CAPABILITY_DENIED',
        'PLATFORM_BRANCH_SCOPE_DENIED',
      ].includes(error.code),
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 0);
    context.close();
  });
}
